param(
    [ValidateSet('Install', 'Test', 'Demo', 'Serve', 'Audit')]
    [string]$Action = 'Demo',
    [string]$ConfigPath,
    [ValidateRange(1024, 65535)][int]$Port = 8767
)
$ErrorActionPreference = 'Stop'
$runtimeDir = Join-Path $env:LOCALAPPDATA 'Inspection\python-signals'
$env:UV_PROJECT_ENVIRONMENT = Join-Path $runtimeDir '.venv'
$env:UV_LINK_MODE = 'copy'
$env:PYTHONUTF8 = '1'
$pythonExe = Join-Path $env:UV_PROJECT_ENVIRONMENT 'Scripts\python.exe'
Push-Location $PSScriptRoot
try {
    if ($Action -eq 'Install') {
        & uv sync --locked --all-extras
        if ($LASTEXITCODE -ne 0) { throw 'Python 套件安裝失敗' }
        return
    }
    if (!(Test-Path -LiteralPath $pythonExe)) { throw '請先執行 -Action Install' }
    switch ($Action) {
        'Test' { & $pythonExe -m pytest -q }
        'Demo' { & $pythonExe demo.py }
        'Audit' { & $pythonExe -m pip_audit }
        'Serve' {
            if (!$ConfigPath) { throw '請指定本機設定檔 -ConfigPath' }
            $env:INSPECTION_SIGNAL_CONFIG = (Resolve-Path -LiteralPath $ConfigPath).Path
            & $pythonExe -m uvicorn service:from_env --factory --host 127.0.0.1 --port $Port --no-access-log --no-proxy-headers
        }
    }
    if ($LASTEXITCODE -ne 0) { throw '訊號服務指令未成功完成' }
} finally { Pop-Location }
