# Restores the WSL Supabase gateway and IIS route on 192.168.50.192.
# ASCII only for Windows PowerShell 5.1. No database, volume, or file removal.

[CmdletBinding()]
param(
  [switch]$Apply,
  [string]$Distribution = '',
  [string]$PublicUrl = 'https://1.34.250.22:5057',
  [int]$IisSitePort = 443,
  [int]$LoopbackPort = 18080
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
[Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
$logPath = Join-Path $env:USERPROFILE 'Downloads\repair-onprem-login-wsl.log'
try { Start-Transcript -LiteralPath $logPath -Force | Out-Null } catch {}

function Is-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Probe {
  param([string]$Url, [string]$Method = 'GET', [string]$Body = '')
  try {
    $request = [Net.WebRequest]::Create($Url)
    $request.Method = $Method
    $request.Timeout = 20000
    if ($Body) {
      $request.ContentType = 'application/json'
      $bytes = [Text.Encoding]::UTF8.GetBytes($Body)
      $request.ContentLength = $bytes.Length
      $stream = $request.GetRequestStream()
      try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
    }
    $response = $request.GetResponse()
  } catch [Net.WebException] {
    $response = $_.Exception.Response
    if (-not $response) { return [pscustomobject]@{ Status = 0; Body = $_.Exception.Message } }
  }
  $status = [int]$response.StatusCode
  $reader = New-Object IO.StreamReader($response.GetResponseStream())
  try { $text = $reader.ReadToEnd() } finally { $reader.Dispose(); $response.Dispose() }
  [pscustomobject]@{ Status = $status; Body = ($text -replace '\s+', ' ') }
}

function Test-LoginApi {
  param([string]$BaseUrl)
  $auth = Probe ($BaseUrl.TrimEnd('/') + '/auth/v1/health')
  $captcha = Probe ($BaseUrl.TrimEnd('/') + '/functions/v1/username-login') 'POST' '{"action":"captcha"}'
  Write-Host ("API {0} auth={1} captcha={2}" -f $BaseUrl, $auth.Status, $captcha.Status)
  [pscustomobject]@{
    # Envoy deliberately answers 401 when the health route is called without an
    # API key. That still proves the auth upstream is reachable; captcha=200 is
    # the functional login-entry check used by this repair.
    Healthy = ($auth.Status -in @(200, 401) -and $captcha.Status -eq 200 -and $captcha.Body -match 'challenge_id')
    Auth = $auth.Status
    Captcha = $captcha.Status
  }
}

$addresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty IPAddress)
if ('192.168.50.192' -notin $addresses) { throw 'Run this script on the formal host 192.168.50.192.' }

$distributions = @(& wsl.exe --list --quiet | ForEach-Object { ($_ -replace "`0", '').Trim() } | Where-Object { $_ -and $_ -notmatch '^docker-desktop' })
if ($LASTEXITCODE -ne 0 -or $distributions.Count -eq 0) { throw 'No application WSL distribution is available.' }
if (-not $Distribution) {
  if ($distributions.Count -ne 1) { throw ('Select -Distribution from: ' + ($distributions -join ', ')) }
  $Distribution = $distributions[0]
}
if ($Distribution -notin $distributions) { throw 'The selected WSL distribution is not registered.' }
$mode = if ($Apply) { 'apply' } else { 'check' }

$linux = @'
set -eu
mode=$1
root=/opt/inspection/supabase
cd "$root"
command -v docker >/dev/null
command -v curl >/dev/null
docker compose version >/dev/null
echo 'Compose services:'
docker compose config --services
echo 'Compose state:'
docker compose ps
if [ "$mode" = apply ]; then
  docker compose up -d
fi
edge=supabase-edge-functions
gateway=''
for candidate in supabase-envoy supabase-kong; do
  if docker inspect "$candidate" >/dev/null 2>&1; then gateway=$candidate; break; fi
done
[ -n "$gateway" ] || { echo 'No WSL gateway container found.' >&2; exit 3; }
[ "$(docker inspect --format '{{.State.Status}}' "$edge")" = running ] || { echo 'Edge container is not running.' >&2; exit 3; }
[ "$(docker inspect --format '{{.State.Status}}' "$gateway")" = running ] || { echo 'Gateway container is not running.' >&2; exit 3; }
echo "Edge container: $edge"
echo "Gateway container: $gateway"
edge_networks=$(docker inspect --format '{{range $name,$value := .NetworkSettings.Networks}}{{$name}} {{end}}' "$edge")
gateway_networks=$(docker inspect --format '{{range $name,$value := .NetworkSettings.Networks}}{{$name}} {{end}}' "$gateway")
echo "Edge networks: $edge_networks"
echo "Gateway networks: $gateway_networks"
common=''
for network in $gateway_networks; do
  case " $edge_networks " in *" $network "*) common=$network; break;; esac
done
if [ -z "$common" ] && [ "$mode" = apply ]; then
  network=$(printf '%s\n' "$gateway_networks" | awk '{print $1}')
  [ -n "$network" ] || exit 3
  echo "Connecting edge container to gateway network: $network"
  docker network connect "$network" "$edge"
  common=$network
fi
[ -n "$common" ] || { echo 'Gateway and edge have no shared Docker network.' >&2; exit 3; }

edge_ip=$(docker inspect --format "{{with index .NetworkSettings.Networks \"$common\"}}{{.IPAddress}}{{end}}" "$edge")
gateway_ip=$(docker inspect --format "{{with index .NetworkSettings.Networks \"$common\"}}{{.IPAddress}}{{end}}" "$gateway")
echo "Shared network: $common"
echo "Edge IP: $edge_ip"
echo "Gateway IP: $gateway_ip"

check_direct() {
  direct=$(curl -sS -o /tmp/inspection-direct.json -w '%{http_code}' --max-time 25 -H 'Content-Type: application/json' -d '{"action":"captcha"}' "http://$edge_ip:9000/username-login" || true)
  via_gateway=$(curl -sS -o /tmp/inspection-gateway.json -w '%{http_code}' --max-time 25 -H 'Content-Type: application/json' -d '{"action":"captcha"}' "http://$gateway_ip:8000/functions/v1/username-login" || true)
  echo "Direct edge captcha: $direct"
  echo "Gateway captcha: $via_gateway"
  [ "$direct" = 200 ] && grep -q challenge_id /tmp/inspection-direct.json && [ "$via_gateway" = 200 ] && grep -q challenge_id /tmp/inspection-gateway.json
}

configure_captcha_secret() {
  compose_file=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$edge" | cut -d, -f1)
  [ -f "$compose_file" ] || { echo 'Cannot locate the active compose file.' >&2; return 1; }
  env_file=$(dirname "$compose_file")/.env
  [ -f "$env_file" ] || { echo 'The active compose .env file is absent.' >&2; return 1; }
  backup_root=/opt/inspection/maintenance/login-repair
  backup="$backup_root/$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$backup"
  chmod 700 "$backup_root" "$backup"
  cp -p "$compose_file" "$backup/compose.yml"
  cp -p "$env_file" "$backup/runtime.env"
  chmod 600 "$backup/runtime.env"
  echo "Configuration backup: $backup"

  python3 - "$env_file" <<'PY'
from pathlib import Path
import os,secrets,sys,tempfile
path=Path(sys.argv[1])
lines=path.read_text(encoding='utf-8').splitlines()
value=''
for line in lines:
    if line.startswith('CAPTCHA_SECRET='):
        value=line.split('=',1)[1].strip().strip('"').strip("'")
        break
if len(value)<32:
    value=secrets.token_urlsafe(48)
    lines=[line for line in lines if not line.startswith('CAPTCHA_SECRET=')]
    lines.append('CAPTCHA_SECRET='+value)
temporary=path.with_name(path.name+'.captcha-repair-tmp')
temporary.write_text('\n'.join(lines)+'\n',encoding='utf-8')
os.chmod(temporary,0o600)
os.replace(temporary,path)
PY

  python3 - "$compose_file" <<'PY'
from pathlib import Path
import os,re,sys
path=Path(sys.argv[1])
lines=path.read_text(encoding='utf-8').splitlines(True)
service=None
for index,line in enumerate(lines):
    if re.match(r'^  functions:\s*(?:#.*)?$',line.rstrip('\r\n')):
        service=index
        break
if service is None:
    raise SystemExit('The functions compose service was not found.')
end=len(lines)
for index in range(service+1,len(lines)):
    if re.match(r'^  [A-Za-z0-9_.-]+:\s*(?:#.*)?$',lines[index].rstrip('\r\n')):
        end=index
        break
environment=None
for index in range(service+1,end):
    if re.match(r'^    environment:\s*(?:#.*)?$',lines[index].rstrip('\r\n')):
        environment=index
        break
if environment is None:
    raise SystemExit('The functions environment mapping was not found.')
existing=None
for index in range(environment+1,end):
    if re.match(r'^\s*(?:-\s*)?CAPTCHA_SECRET\s*[:=]',lines[index]):
        existing=index
        break
first_value=next((lines[index] for index in range(environment+1,end) if lines[index].strip() and not lines[index].lstrip().startswith('#')), '')
list_style=bool(re.match(r'^\s+-\s+',first_value))
replacement=('      - CAPTCHA_SECRET=${CAPTCHA_SECRET}\n' if list_style else '      CAPTCHA_SECRET: ${CAPTCHA_SECRET}\n')
if existing is None:
    lines.insert(environment+1,replacement)
else:
    lines[existing]=replacement
temporary=path.with_name(path.name+'.captcha-repair-tmp')
temporary.write_text(''.join(lines),encoding='utf-8')
os.replace(temporary,path)
PY

  if ! docker compose config --quiet; then
    cp -p "$backup/compose.yml" "$compose_file"
    cp -p "$backup/runtime.env" "$env_file"
    echo 'Compose validation failed; original files restored.' >&2
    return 1
  fi
  if ! docker compose up -d --no-deps --force-recreate functions; then
    cp -p "$backup/compose.yml" "$compose_file"
    cp -p "$backup/runtime.env" "$env_file"
    docker compose up -d --no-deps --force-recreate functions || true
    echo 'Function recreation failed; original files restored.' >&2
    return 1
  fi
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$edge" | grep -Eq '^CAPTCHA_SECRET=.{32,}$' || {
    echo 'The recreated function container still lacks CAPTCHA_SECRET.' >&2
    return 1
  }
  sleep 6
}

if ! check_direct && [ "$mode" = apply ] && docker logs --tail 40 "$edge" 2>&1 | grep -q 'CAPTCHA_SECRET is not configured'; then
  echo 'Installing a dedicated CAPTCHA secret without exposing its value ...'
  configure_captcha_secret || exit 3
fi

if ! check_direct && [ "$mode" = apply ]; then
  edge_service=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$edge")
  gateway_service=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$gateway")
  echo "Recreating scoped services: $edge_service $gateway_service"
  docker compose up -d --no-deps --force-recreate "$edge_service" "$gateway_service"
  sleep 8
  edge_networks=$(docker inspect --format '{{range $name,$value := .NetworkSettings.Networks}}{{$name}} {{end}}' "$edge")
  gateway_networks=$(docker inspect --format '{{range $name,$value := .NetworkSettings.Networks}}{{$name}} {{end}}' "$gateway")
  common=''
  for network in $gateway_networks; do case " $edge_networks " in *" $network "*) common=$network; break;; esac; done
  edge_ip=$(docker inspect --format "{{with index .NetworkSettings.Networks \"$common\"}}{{.IPAddress}}{{end}}" "$edge")
  gateway_ip=$(docker inspect --format "{{with index .NetworkSettings.Networks \"$common\"}}{{.IPAddress}}{{end}}" "$gateway")
  check_direct || {
    echo 'Edge log tail:'
    docker logs --tail 80 "$edge" 2>&1 || true
    echo 'Gateway log tail:'
    docker logs --tail 80 "$gateway" 2>&1 || true
    exit 3
  }
fi
check_direct || exit 3
wsl_ip=$(hostname -I | awk '{print $1}')
echo "WSL_GATEWAY_IP=$wsl_ip"
rm -f /tmp/inspection-direct.json /tmp/inspection-gateway.json
'@

Write-Host ('WSL distribution: ' + $Distribution)
$linuxScriptPath = Join-Path $env:TEMP 'repair-onprem-login-wsl-linux.sh'
$linuxLf = $linux.Replace("`r`n", "`n").Replace("`r", "`n")
[IO.File]::WriteAllText($linuxScriptPath, $linuxLf, (New-Object Text.UTF8Encoding($false)))
$savedErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  $wslScriptPathOutput = @(& wsl.exe --distribution $Distribution --user root --exec wslpath -a -u $linuxScriptPath 2>&1)
  $wslPathExit = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $savedErrorActionPreference
}
if ($wslPathExit -ne 0) { throw 'Cannot translate the temporary repair-script path for WSL.' }
$wslScriptPath = ([string]($wslScriptPathOutput | Select-Object -Last 1)).Trim()
if (-not $wslScriptPath) { throw 'WSL returned an empty repair-script path.' }
$savedErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  # Windows PowerShell 5.1 wraps native stderr as NativeCommandError. Docker
  # writes ordinary progress (for example, "Container ... Running") there,
  # so capture it and judge the native exit code instead of stopping early.
  $wslOutput = @(& wsl.exe --distribution $Distribution --user root --exec sh $wslScriptPath $mode 2>&1)
  $wslExit = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $savedErrorActionPreference
  Remove-Item -LiteralPath $linuxScriptPath -Force -ErrorAction SilentlyContinue
}
$wslOutput | ForEach-Object { Write-Host $_ }
if ($wslExit -ne 0) { throw ('WSL service repair failed with exit code ' + $wslExit + '. Log: ' + $logPath) }
$ipLine = @($wslOutput | Where-Object { $_ -match '^WSL_GATEWAY_IP=' } | Select-Object -Last 1)
if (-not $ipLine) { throw 'WSL gateway IP was not reported.' }
$wslIp = ([string]$ipLine).Split('=', 2)[1].Trim()
if ($wslIp -notmatch '^(?:\d{1,3}\.){3}\d{1,3}$') { throw 'WSL gateway IP is invalid.' }

$directWindows = Test-LoginApi ("http://{0}:8000" -f $wslIp)
if (-not $directWindows.Healthy) { throw ('Windows cannot reach the healthy WSL gateway at ' + $wslIp + ':8000.') }
$public = Test-LoginApi $PublicUrl
if ($public.Healthy) { Write-Host 'LOGIN_REPAIR_OK' -ForegroundColor Green; try { Stop-Transcript | Out-Null } catch {}; exit 0 }
if (-not $Apply) { throw 'Public IIS route is unhealthy. Re-run from Administrator PowerShell with -Apply.' }
if (-not (Is-Admin)) { throw 'IIS repair requires Administrator PowerShell.' }

$loopbackUrl = "http://127.0.0.1:$LoopbackPort"
$existingLoopback = Test-LoginApi $loopbackUrl
if (-not $existingLoopback.Healthy) {
  & netsh.exe interface portproxy delete v4tov4 listenaddress=127.0.0.1 listenport=$LoopbackPort | Out-Null
  & netsh.exe interface portproxy add v4tov4 listenaddress=127.0.0.1 listenport=$LoopbackPort connectaddress=$wslIp connectport=8000 | Out-Null
  Start-Sleep -Seconds 2
  $loopback = Test-LoginApi $loopbackUrl
  if (-not $loopback.Healthy) { throw 'Windows loopback bridge to WSL failed.' }
}

Import-Module WebAdministration -ErrorAction Stop
$site = $null
foreach ($candidate in (Get-Website)) {
  foreach ($binding in $candidate.Bindings.Collection) {
    if ($binding.bindingInformation -match (':' + $IisSitePort + ':')) { $site = $candidate; break }
  }
  if ($site) { break }
}
if (-not $site) { throw ('No IIS site is bound to port ' + $IisSitePort + '.') }
$root = [Environment]::ExpandEnvironmentVariables($site.PhysicalPath)
$configPath = Join-Path $root 'web.config'
if (Test-Path -LiteralPath $configPath) {
  $backupPath = $configPath + '.bak-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
  Copy-Item -LiteralPath $configPath -Destination $backupPath -Force
  Write-Host ('IIS config backup: ' + $backupPath)
}
$rules = @(Get-WebConfiguration -PSPath ('IIS:\Sites\' + $site.Name) -Filter 'system.webServer/rewrite/rules/rule')
$apiRule = @($rules | Where-Object { $_.match.url -match 'auth\|rest|auth.*rest' } | Select-Object -First 1)
if (-not $apiRule) { throw 'The Supabase IIS rewrite rule was not found.' }
$currentTarget = [string]$apiRule.action.url
$newTarget = $currentTarget -replace '^https?://[^/]+', $loopbackUrl
if ($newTarget -eq $currentTarget -and $currentTarget -notlike ($loopbackUrl + '*')) { throw 'The IIS rewrite target format is unexpected.' }
Set-WebConfigurationProperty -PSPath ('IIS:\Sites\' + $site.Name) `
  -Filter ("system.webServer/rewrite/rules/rule[@name='" + $apiRule.name + "']/action") `
  -Name 'url' -Value $newTarget
Write-Host ('IIS rule updated: ' + $apiRule.name + ' -> ' + $newTarget)

Start-Sleep -Seconds 2
$verified = Test-LoginApi $PublicUrl
if (-not $verified.Healthy) { throw 'Public login API is still unhealthy after the scoped IIS update.' }
Write-Host 'LOGIN_REPAIR_OK' -ForegroundColor Green
try { Stop-Transcript | Out-Null } catch {}
