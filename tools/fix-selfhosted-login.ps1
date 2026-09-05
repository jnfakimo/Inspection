# Auto-fix self-hosted login captcha boot error (edge_runtime cannot read
# functions bind-mounted from Google Drive). Pure ASCII so PowerShell 5.1 never
# mis-decodes it. Source path is auto-detected from docker inspect at runtime.
# Run on the Docker host:  powershell -ExecutionPolicy Bypass -File <this file>
$ErrorActionPreference="Stop"
try{[Console]::OutputEncoding=[System.Text.Encoding]::UTF8}catch{}
$C="supabase_edge_runtime_0705"
$Dst="C:\supabase-0705\functions"
$Anon="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"

if(-not(Get-Command docker -ErrorAction SilentlyContinue)){throw "docker not found; run on the Docker host"}
$found=docker ps -a --format "{{.Names}}"|Select-String -SimpleMatch $C
if(-not $found){throw "container $C not found; start the 0705 stack first"}

Write-Host "[1/4] inspecting current edge_runtime ..."
$c0=(docker inspect $C|ConvertFrom-Json)[0]
$fnMount=$c0.Mounts|Where-Object{$_.Destination -match "functions"}|Select-Object -First 1
if(-not $fnMount){throw "functions mount not found"}
$fnDest=$fnMount.Destination
$src=$fnMount.Source
$winSrc=$src
if($src -match "^/run/desktop/mnt/host/([a-zA-Z])/(.*)$"){$winSrc=$matches[1].ToUpper()+":\"+($matches[2] -replace "/","\")}
elseif($src -match "^/host_mnt/([a-zA-Z])/(.*)$"){$winSrc=$matches[1].ToUpper()+":\"+($matches[2] -replace "/","\")}
Write-Host ("      source = "+$winSrc)
if(-not(Test-Path -LiteralPath $winSrc)){throw ("source not accessible: "+$winSrc)}

Write-Host "[2/4] copying functions to $Dst (real disk) ..."
robocopy $winSrc $Dst /E /XD node_modules .branches .temp /NFL /NDL /NJH /NJS /R:2 /W:2|Out-Null
if($LASTEXITCODE -ge 8){throw ("robocopy failed ("+$LASTEXITCODE+")")}
$idx=Join-Path $Dst "username-login\index.ts"
if(-not(Test-Path -LiteralPath $idx) -or (Get-Item -LiteralPath $idx).Length -lt 1000){throw "copied index.ts invalid"}
Write-Host ("      OK: username-login/index.ts = "+(Get-Item -LiteralPath $idx).Length+" bytes") -ForegroundColor Green

Write-Host "[3/4] rebuilding edge_runtime bound to local disk (db untouched) ..."
$image=$c0.Config.Image;$cmd=@($c0.Config.Cmd);$entry=@($c0.Config.Entrypoint)
$envs=@($c0.Config.Env);$workdir=$c0.Config.WorkingDir
$net=@($c0.NetworkSettings.Networks.PSObject.Properties.Name)[0]
$denoM=$c0.Mounts|Where-Object{$_.Destination -match "deno"}|Select-Object -First 1
docker rm -f $C|Out-Null
$dargs=@("run","-d","--name",$C,"--network",$net,"--restart","unless-stopped")
if($workdir){$dargs+=@("-w",$workdir)}
foreach($e in $envs){$dargs+=@("-e",$e)}
$dargs+=@("-v",("{0}:{1}:ro" -f $Dst,$fnDest))
if($denoM){if($denoM.Type -eq "volume"){$dargs+=@("-v",("{0}:{1}" -f $denoM.Name,$denoM.Destination))}else{$dargs+=@("-v",("{0}:{1}" -f $denoM.Source,$denoM.Destination))}}
$tail=@()
if($entry.Count -gt 0 -and $entry[0]){$dargs+=@("--entrypoint",$entry[0]);if($entry.Count -gt 1){$tail+=$entry[1..($entry.Count-1)]}}
$tail+=$cmd
$dargs+=$image;$dargs+=$tail
docker @dargs|Out-Null
Start-Sleep -Seconds 8

Write-Host "[4/4] verifying captcha API ..."
try{
  $r=Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:54321/functions/v1/username-login" -Headers @{apikey=$Anon;Authorization="Bearer $Anon";"Content-Type"="application/json"} -Body '{"action":"captcha"}'
  if($r.challenge_id){Write-Host ("[OK] captcha restored (challenge_id="+$r.challenge_id+")") -ForegroundColor Green;Write-Host "Reload the login page with Ctrl+Shift+R -- the captcha should appear." -ForegroundColor Green}
  else{Write-Host "[?] no challenge_id:";$r|ConvertTo-Json -Depth 5}
}catch{Write-Host ("[FAIL] "+$_.Exception.Message) -ForegroundColor Red;Write-Host "---- last 25 log lines ----";docker logs $C --tail 25}
