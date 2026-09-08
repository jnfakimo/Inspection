param([Parameter(Mandatory=$true)][string]$StateDirectory)
$ErrorActionPreference='Stop'
$base=[IO.Path]::GetFullPath($env:LOCALAPPDATA).TrimEnd('\')+'\'
$resolved=(Resolve-Path -LiteralPath $StateDirectory).Path
if (-not $resolved.StartsWith($base,[StringComparison]::OrdinalIgnoreCase)) {throw '同步資料目錄不在本機私人範圍。'}
if (-not (Test-Path -LiteralPath (Join-Path $resolved 'state.dpapi'))) {throw '請先完成桌機配對。'}
$check=Get-Item -LiteralPath $resolved
while($check){
  if($check.Attributes -band [IO.FileAttributes]::ReparsePoint){throw '私人路徑有重新導向，已停止。'}
  if(Test-Path -LiteralPath (Join-Path $check.FullName '.git')){throw '不可將同步資料放在版控專案。'}
  $check=$check.Parent
}
$runtime=Join-Path $resolved 'agent'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
foreach($file in @('findtag-sync.py','findtag-visible-probe.py')) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $runtime $file) -Force
}
$pythonPath=(& python -c 'import sys; print(sys.executable)').Trim()
$pythonHidden=Join-Path (Split-Path -Parent $pythonPath) 'pythonw.exe'
if(-not (Test-Path -LiteralPath $pythonHidden)){throw '找不到背景執行用 Python。'}
$taskName='Beinong-FindTag-VisibleSync'
$existing=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if($existing -and $existing.Description -notlike 'Beinong FindTag visible-list sync*'){throw '排程名稱已由其他工作使用，未覆蓋。'}
$userId=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal=New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$scriptPath=Join-Path $runtime 'findtag-sync.py'
$action=New-ScheduledTaskAction -Execute $pythonHidden -Argument ('"'+$scriptPath+'" --state-dir "'+$resolved+'"') -WorkingDirectory $runtime
$trigger=New-ScheduledTaskTrigger -AtLogOn -User $userId
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Description 'Beinong FindTag visible-list sync; current user only; no GPS inference.' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output '已安裝並啟動本機 FindTag 自動同步；每次登入 Windows 自動啟動，FindTag 清單仍須保持開啟。'
