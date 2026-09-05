# selfhosted-restore-login.ps1
# ---------------------------------------------------------------------------
# One-shot repair for the on-prem site (external https://1.34.250.22:5057,
# Docker/IIS host 192.168.50.192) so that browser login works again.
#
# Measured state on 2026-09-05 from the dev machine (see handoff.md):
#   local Kong 54321 speaks HTTPS
#   /auth/v1/health        -> 200 GoTrue          (local stack healthy)
#   /rest/v1/              -> 200 postgrest/14.5  (87 tables, correct schema)
#   /functions/v1/...      -> 503 kong "name resolution failed"
#                             (edge_runtime container is not on the network)
#   IIS on 5057 forwards /functions and /storage to the CLOUD project
#   (responses carry x-envoy-upstream-service-time), and does NOT forward
#   /auth, /rest, /realtime at all (they get IIS's own plain-text 401).
#
# The front end uses window.location.origin as SUPABASE_URL whenever the page
# is opened by IP (web/lib/config.ts), so every Supabase call goes to 5057.
# Login therefore breaks twice over: /auth and /rest are not proxied, and the
# calls that ARE proxied land on a different database than the one the rest of
# the site would use. All five prefixes must point at the SAME backend.
#
# This script targets the local stack, which is what the host is set up for
# (the 168 MB supabase_db_0705 volume holds the real data).
#
# Pure ASCII on purpose: PowerShell 5.1 decodes .ps1 as Big5 on this machine
# and any Chinese character corrupts the whole file.
#
# Usage (elevated PowerShell on the Docker/IIS host 192.168.50.192):
#   powershell -ExecutionPolicy Bypass -File .\selfhosted-restore-login.ps1
#       ... dry run, changes nothing, prints what it would do
#   powershell -ExecutionPolicy Bypass -File .\selfhosted-restore-login.ps1 -Apply
#       ... actually starts the stack and rewrites the IIS config
#
#   -Step stack   only bring the Supabase stack up
#   -Step iis     only fix the IIS reverse proxy
#   -Step verify  only re-run the checks
# ---------------------------------------------------------------------------

[CmdletBinding()]
param(
  [string]$ProjectDir = 'C:\supabase-0705',
  [string]$PublicUrl  = 'https://1.34.250.22:5057',
  # Host publishing the Supabase gateway. Leave at 127.0.0.1 when running on
  # the Docker host; set it to 192.168.50.192 to probe the box from another
  # machine on the LAN (the IIS section still has to run on the host itself).
  [string]$KongHost   = '127.0.0.1',
  [int]$SitePort      = 443,
  [switch]$Apply,
  [ValidateSet('all','stack','iis','verify')]
  [string]$Step = 'all'
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
[Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }

$script:Problems = @()
function Say  ($m) { Write-Host $m }
function Head ($m) { Write-Host ''; Write-Host ("== " + $m) -ForegroundColor Cyan }
function Ok   ($m) { Write-Host ("   [ok]   " + $m) -ForegroundColor Green }
function Warn ($m) { Write-Host ("   [warn] " + $m) -ForegroundColor Yellow }
function Bad  ($m) { Write-Host ("   [FAIL] " + $m) -ForegroundColor Red; $script:Problems += $m }
function Plan ($m) { Write-Host ("   [plan] " + $m) -ForegroundColor Magenta }

function Invoke-Probe {
  param([string]$Url, [string]$Method = 'GET', [string]$Body)
  try {
    $req = [Net.WebRequest]::Create($Url)
    $req.Method  = $Method
    $req.Timeout = 20000
    if ($Body) {
      $req.ContentType = 'application/json'
      $bytes = [Text.Encoding]::UTF8.GetBytes($Body)
      $req.ContentLength = $bytes.Length
      $s = $req.GetRequestStream(); $s.Write($bytes, 0, $bytes.Length); $s.Close()
    }
    $resp = $req.GetResponse()
  } catch [Net.WebException] {
    $resp = $_.Exception.Response
    if (-not $resp) { return [pscustomobject]@{ Status = 0; Body = $_.Exception.Message; Upstream = 'unreachable' } }
  }
  $reader = New-Object IO.StreamReader($resp.GetResponseStream())
  $text = $reader.ReadToEnd(); $reader.Close()
  $upstream = 'local'
  if ($resp.Headers['x-envoy-upstream-service-time']) { $upstream = 'CLOUD' }
  elseif ($resp.Headers['Server'] -match 'kong')      { $upstream = 'kong' }
  elseif (-not $resp.Headers['Server'])               { $upstream = 'iis-or-static' }
  [pscustomobject]@{
    Status   = [int]$resp.StatusCode
    Body     = ($text -replace '\s+', ' ')
    Upstream = $upstream
  }
}

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
}

Say '=============================================================='
Say ' on-prem login repair'
Say (" mode       : " + $(if ($Apply) { 'APPLY (will change the host)' } else { 'DRY RUN (no changes)' }))
Say (" step       : " + $Step)
Say (" projectdir : " + $ProjectDir)
Say '=============================================================='

# ---------------------------------------------------------------------------
# 1. Supabase stack
# ---------------------------------------------------------------------------
$kongBase  = $null
$kongPlain = $null

if ($Step -eq 'all' -or $Step -eq 'stack') {
  Head '1. Docker stack'

  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Bad 'docker CLI not found. Run this on the Docker host (192.168.50.192).'
  } else {
    $names = @(docker ps -a --format '{{.Names}}\t{{.Status}}' 2>$null)
    if (-not $names) {
      Bad 'docker responded with no containers. Is Docker Desktop running?'
    } else {
      foreach ($line in $names) {
        if ($line -match '^supabase_') {
          $parts = $line -split "`t"
          if ($parts[1] -match '^Up') { Ok ($parts[0] + '  ' + $parts[1]) }
          else                        { Warn ($parts[0] + '  ' + $parts[1]) }
        }
      }
    }

    # Which host port does Kong publish, and on which scheme?
    $kongName = @(docker ps -a --format '{{.Names}}' 2>$null | Where-Object { $_ -match 'kong' })
    if ($kongName.Count -gt 0) {
      Say ''
      Say ('   kong container : ' + $kongName[0])
      $ports = @(docker port $kongName[0] 2>$null)
      foreach ($p in $ports) { Say ('   port           : ' + $p) }
      Say '   (container 8000 = plain HTTP, 8443 = HTTPS; 54321 answers HTTPS today)'
    }
  }

  # --- locate the supabase CLI -------------------------------------------
  Head '2. supabase CLI'
  $cli = $null
  $cmd = Get-Command supabase -ErrorAction SilentlyContinue
  if ($cmd) { $cli = $cmd.Source }

  if (-not $cli) {
    $candidates = @(
      (Join-Path $env:USERPROFILE 'scoop\shims\supabase.exe'),
      (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\supabase.exe'),
      (Join-Path $env:APPDATA 'npm\supabase.cmd'),
      'C:\ProgramData\chocolatey\bin\supabase.exe',
      'C:\Program Files\Supabase\supabase.exe'
    )
    foreach ($c in $candidates) {
      if (Test-Path -LiteralPath $c) { $cli = $c; break }
    }
  }

  if (-not $cli) {
    # Last resort: the CLI was installed for some user profile on this box.
    Say '   not on PATH; scanning user profiles (this can take a minute) ...'
    $hits = @(Get-ChildItem -Path 'C:\Users' -Filter 'supabase.exe' -Recurse -ErrorAction SilentlyContinue |
              Select-Object -First 3)
    if ($hits.Count -gt 0) { $cli = $hits[0].FullName }
  }

  if ($cli) {
    Ok ('found: ' + $cli)
    try { Say ('   version: ' + (& $cli --version 2>&1 | Select-Object -First 1)) } catch {}
  } else {
    Bad 'supabase CLI not found. Install it (scoop install supabase / winget install Supabase.CLI) or run "supabase start" from the terminal that originally started the stack.'
  }

  # --- project directory sanity ------------------------------------------
  Head '3. Project directory'
  if (-not (Test-Path -LiteralPath $ProjectDir)) {
    Bad ($ProjectDir + ' does not exist. Copy the 0705 project to a real local disk first.')
  } else {
    $drive = (Split-Path -Qualifier $ProjectDir)
    $dt = (Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $drive + "'") -ErrorAction SilentlyContinue)
    if ($dt -and $dt.DriveType -ne 3) {
      Bad ($drive + ' is not a fixed local disk (DriveType=' + $dt.DriveType + '). Docker cannot bind-mount Google Drive; that is the original boot failure.')
    } else {
      Ok ($ProjectDir + ' is on a fixed local disk')
    }
    foreach ($need in @('supabase\config.toml', 'supabase\functions\username-login\index.ts')) {
      $p = Join-Path $ProjectDir $need
      if (Test-Path -LiteralPath $p) {
        Ok ($need + '  (' + (Get-Item -LiteralPath $p).Length + ' bytes)')
      } else {
        # The functions may sit at the project root instead of under supabase\.
        $alt = Join-Path $ProjectDir ($need -replace '^supabase\\', '')
        if (Test-Path -LiteralPath $alt) { Warn ($need + ' missing, but found at ' + $alt) }
        else { Bad ('missing: ' + $p) }
      }
    }
  }

  # --- start the stack ----------------------------------------------------
  Head '4. supabase start'
  if (-not $cli) {
    Warn 'skipped: no CLI'
  } elseif (-not $Apply) {
    Plan ('cd "' + $ProjectDir + '"  &  "' + $cli + '" start')
    Plan 'this reuses the existing supabase_db_0705 volume and regenerates the /root main service that plain "docker run" cannot produce'
  } else {
    Push-Location $ProjectDir
    try {
      Say '   running "supabase start" (this can take several minutes) ...'
      & $cli start 2>&1 | ForEach-Object { Say ('     ' + $_) }
    } finally {
      Pop-Location
    }
  }
}

# ---------------------------------------------------------------------------
# 2. Determine the working Kong base URL
# ---------------------------------------------------------------------------
if ($Step -eq 'all' -or $Step -eq 'stack' -or $Step -eq 'verify' -or $Step -eq 'iis') {
  Head '5. Local Supabase gateway'
  foreach ($base in @(('https://' + $KongHost + ':54321'), ('http://' + $KongHost + ':54321'))) {
    $r = Invoke-Probe ($base + '/auth/v1/health')
    if ($r.Status -eq 200) { $kongBase = $base; Ok ($base + '  ->  ' + $r.Body.Substring(0, [Math]::Min(80, $r.Body.Length))); break }
    Say ('   ' + $base + '  -> ' + $r.Status)
  }
  if (-not $kongBase) {
    Bad ('neither https nor http answers on ' + $KongHost + ':54321 - the stack is down')
  } else {
    $rest = Invoke-Probe ($kongBase + '/rest/v1/')
    if ($rest.Status -eq 200) { Ok 'rest/v1  200 (PostgREST)' } else { Bad ('rest/v1 -> ' + $rest.Status) }

    # ARR is fragile in front of a self-signed HTTPS backend (it answers 502.3).
    # If Kong also publishes a plain-HTTP port on the host, that is the safer
    # target for the IIS rewrite rule.
    foreach ($h in @(('http://' + $KongHost + ':8000'), ('http://' + $KongHost + ':54321'))) {
      $probe = Invoke-Probe ($h + '/auth/v1/health')
      if ($probe.Status -eq 200) { $kongPlain = $h; break }
    }
    if ($kongPlain) {
      Ok ('plain-HTTP gateway at ' + $kongPlain + ' - the IIS rule will use this')
    } elseif ($kongBase -like 'https:*') {
      Warn 'only HTTPS is published on the gateway. If ARR answers 502.3 after the rule is installed, publish Kong container port 8000 on the host (docker compose / config.toml) and re-run -Step iis.'
    }

    $fn = Invoke-Probe ($kongBase + '/functions/v1/username-login') 'POST' '{"action":"captcha"}'
    if ($fn.Status -eq 200 -and $fn.Body -match 'challenge_id') {
      Ok 'functions/v1/username-login  200 with challenge_id - edge runtime is healthy'
    } elseif ($fn.Body -match 'name resolution failed') {
      Bad 'functions/v1 -> 503 "name resolution failed": the edge_runtime container is not running. Re-run with -Apply so "supabase start" rebuilds it.'
    } else {
      Bad ('functions/v1 -> ' + $fn.Status + ' ' + $fn.Body.Substring(0, [Math]::Min(160, $fn.Body.Length)))
    }
  }
}

# ---------------------------------------------------------------------------
# 3. IIS reverse proxy
# ---------------------------------------------------------------------------
if ($Step -eq 'all' -or $Step -eq 'iis') {
  Head '6. IIS reverse proxy'

  if (-not (Test-Admin)) {
    Bad 'not elevated - re-run this script from an Administrator PowerShell to touch IIS'
  } else {
    try { Import-Module WebAdministration -ErrorAction Stop; Ok 'WebAdministration module loaded' }
    catch { Bad 'WebAdministration module unavailable - is the IIS management console installed?' }

    if (Get-Module WebAdministration) {

      # -- required modules -------------------------------------------------
      $rewriteInstalled = Test-Path 'HKLM:\SOFTWARE\Microsoft\IIS Extensions\URL Rewrite'
      $arrInstalled     = Test-Path 'HKLM:\SOFTWARE\Microsoft\IIS Extensions\Application Request Routing'
      if ($rewriteInstalled) { Ok 'URL Rewrite installed' } else { Bad 'URL Rewrite 2.1 is NOT installed - download it from iis.net first' }
      if ($arrInstalled)     { Ok 'Application Request Routing installed' } else { Bad 'ARR 3.0 is NOT installed - download it from iis.net first' }

      # -- ARR proxy must be enabled ---------------------------------------
      $proxyEnabled = $false
      try {
        $proxyEnabled = [bool](Get-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' `
          -Filter 'system.webServer/proxy' -Name 'enabled' -ErrorAction Stop).Value
      } catch {}
      if ($proxyEnabled) {
        Ok 'ARR proxy already enabled'
      } elseif (-not $Apply) {
        Plan 'enable ARR proxy (Server node -> Application Request Routing Cache -> Server Proxy Settings -> Enable proxy)'
      } else {
        Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' `
          -Filter 'system.webServer/proxy' -Name 'enabled' -Value 'True'
        Ok 'ARR proxy enabled'
      }

      # -- find the site serving $SitePort ----------------------------------
      $site = $null
      foreach ($s in (Get-Website)) {
        foreach ($b in $s.Bindings.Collection) {
          if ($b.bindingInformation -match (':' + $SitePort + ':')) { $site = $s; break }
        }
        if ($site) { break }
      }
      if (-not $site) {
        Bad ('no IIS site bound to port ' + $SitePort + '. Sites: ' + ((Get-Website | ForEach-Object { $_.Name }) -join ', '))
      } else {
        $root = [Environment]::ExpandEnvironmentVariables($site.PhysicalPath)
        Ok ('site "' + $site.Name + '"  ->  ' + $root)
        $cfgPath = Join-Path $root 'web.config'

        # -- inspect the rules that exist today ----------------------------
        $existing = @()
        try {
          $existing = @(Get-WebConfiguration -PSPath ('IIS:\Sites\' + $site.Name) `
            -Filter 'system.webServer/rewrite/rules/rule' -ErrorAction Stop)
        } catch {}
        Say ('   existing rewrite rules: ' + $existing.Count)
        foreach ($r in $existing) {
          $target = ''
          try { $target = $r.action.url } catch {}
          $flag = ''
          if ($target -match 'supabase\.co') { $flag = '   <-- points at the CLOUD project' }
          Say ('     - ' + $r.name + '  match="' + $r.match.url + '"  ->  ' + $target + $flag)
        }
        $cloudRules = @($existing | Where-Object { $_.action.url -match 'supabase\.co' })
        if ($cloudRules.Count -gt 0) {
          Warn ($cloudRules.Count.ToString() + ' rule(s) forward to the cloud project. They must go, otherwise /functions and /storage keep hitting a different database than /auth and /rest.')
        }

        $wantTarget = $kongPlain
        if (-not $wantTarget) { $wantTarget = $kongBase }
        if (-not $wantTarget) { $wantTarget = 'https://127.0.0.1:54321' }
        # The IIS rule always dials the loopback, never -KongHost.
        $wantTarget = $wantTarget -replace '://[^:/]+:', '://127.0.0.1:'
        $ruleUrl = $wantTarget + '/{R:1}/{R:2}'

        if (-not $Apply) {
          Plan ('back up ' + $cfgPath)
          foreach ($r in $cloudRules) { Plan ('remove rule "' + $r.name + '" (cloud target)') }
          Plan ('add first rule "Supabase reverse proxy": ^(auth|rest|storage|realtime|functions)/(.*)  ->  ' + $ruleUrl)
        } else {
          if (Test-Path -LiteralPath $cfgPath) {
            $backup = $cfgPath + '.bak-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
            Copy-Item -LiteralPath $cfgPath -Destination $backup -Force
            Ok ('backed up -> ' + $backup)
          } else {
            Warn ('no web.config at ' + $cfgPath + ' - one will be created')
          }

          foreach ($r in $cloudRules) {
            Remove-WebConfigurationProperty -PSPath ('IIS:\Sites\' + $site.Name) `
              -Filter 'system.webServer/rewrite/rules' -Name '.' `
              -AtElement @{ name = $r.name }
            Ok ('removed cloud rule "' + $r.name + '"')
          }

          $mine = @($existing | Where-Object { $_.name -eq 'Supabase reverse proxy' })
          if ($mine.Count -gt 0) {
            Remove-WebConfigurationProperty -PSPath ('IIS:\Sites\' + $site.Name) `
              -Filter 'system.webServer/rewrite/rules' -Name '.' `
              -AtElement @{ name = 'Supabase reverse proxy' }
          }

          Add-WebConfigurationProperty -PSPath ('IIS:\Sites\' + $site.Name) `
            -Filter 'system.webServer/rewrite/rules' -Name '.' -AtIndex 0 `
            -Value @{ name = 'Supabase reverse proxy'; stopProcessing = 'True' }
          Set-WebConfigurationProperty -PSPath ('IIS:\Sites\' + $site.Name) `
            -Filter "system.webServer/rewrite/rules/rule[@name='Supabase reverse proxy']/match" `
            -Name 'url' -Value '^(auth|rest|storage|realtime|functions)/(.*)'
          Set-WebConfigurationProperty -PSPath ('IIS:\Sites\' + $site.Name) `
            -Filter "system.webServer/rewrite/rules/rule[@name='Supabase reverse proxy']/action" `
            -Name 'type' -Value 'Rewrite'
          Set-WebConfigurationProperty -PSPath ('IIS:\Sites\' + $site.Name) `
            -Filter "system.webServer/rewrite/rules/rule[@name='Supabase reverse proxy']/action" `
            -Name 'url' -Value $ruleUrl
          Set-WebConfigurationProperty -PSPath ('IIS:\Sites\' + $site.Name) `
            -Filter "system.webServer/rewrite/rules/rule[@name='Supabase reverse proxy']/action" `
            -Name 'appendQueryString' -Value 'True'
          Ok ('rule installed  ->  ' + $ruleUrl)
        }
      }
    }
  }
}

# ---------------------------------------------------------------------------
# 4. End-to-end verification through the public origin
# ---------------------------------------------------------------------------
if ($Step -eq 'all' -or $Step -eq 'verify') {
  Head '7. End-to-end through the public origin'
  Say ('   ' + $PublicUrl)

  $checks = @(
    @{ Name = 'auth/v1/health'; Url = '/auth/v1/health'; Method = 'GET'; Body = $null; Want = 200 },
    @{ Name = 'rest/v1/';       Url = '/rest/v1/';       Method = 'GET'; Body = $null; Want = 200 },
    @{ Name = 'functions captcha'; Url = '/functions/v1/username-login'; Method = 'POST'; Body = '{"action":"captcha"}'; Want = 200 }
  )
  foreach ($c in $checks) {
    $r = Invoke-Probe ($PublicUrl + $c.Url) $c.Method $c.Body
    $line = '{0,-18} {1,-4} upstream={2}' -f $c.Name, $r.Status, $r.Upstream
    if ($r.Status -eq $c.Want -and $r.Upstream -ne 'CLOUD') { Ok $line }
    elseif ($r.Upstream -eq 'CLOUD') { Bad ($line + '  still going to the cloud project') }
    elseif ($r.Status -eq 401 -and -not $r.Body.StartsWith('{')) { Bad ($line + '  plain-text 401 = IIS is not proxying this prefix') }
    else { Bad ($line + '  ' + $r.Body.Substring(0, [Math]::Min(120, $r.Body.Length))) }
  }
}

# ---------------------------------------------------------------------------
Head 'Result'
if ($script:Problems.Count -eq 0) {
  Write-Host '   Everything checked out. Reload the login page with Ctrl+Shift+R.' -ForegroundColor Green
} else {
  Write-Host ('   ' + $script:Problems.Count + ' problem(s) still open:') -ForegroundColor Yellow
  $i = 1
  foreach ($p in $script:Problems) { Write-Host ('     ' + $i + '. ' + $p); $i++ }
  if (-not $Apply) {
    Write-Host ''
    Write-Host '   This was a DRY RUN. Re-run with -Apply to perform the [plan] items.' -ForegroundColor Yellow
  }
}
Write-Host ''
