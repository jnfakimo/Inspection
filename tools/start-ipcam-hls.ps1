param(
  [string]$RtspUrl = $env:IPCAM_RTSP_URL,
  [int]$Port = 8091
)

$ErrorActionPreference = "Stop"

while ([string]::IsNullOrWhiteSpace($RtspUrl)) {
  $RtspUrl = Read-Host "RTSP URL, for example rtsp://admin:password@1.34.250.22:10273/channel1"
}

$RtspUrl = $RtspUrl.Trim()
if (($RtspUrl.ToCharArray() | Where-Object { $_ -eq "@" } | Measure-Object).Count -gt 1) {
  throw "RTSP URL has more than one @. If the password contains @, replace it with %40 before running this script."
}
if ($RtspUrl -notmatch "^rtsp://") {
  throw "RTSP URL must start with rtsp://"
}

$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ffmpeg) {
  throw "ffmpeg was not found in PATH."
}

$python = Get-Command py -ErrorAction SilentlyContinue
if (-not $python) {
  $python = Get-Command python -ErrorAction SilentlyContinue
}
if (-not $python -or $python.Source -match "\\WindowsApps\\|\\system32\\python(?:\\.exe)?$") {
  $localPython = Get-ChildItem "$env:LOCALAPPDATA\Programs\Python" -Recurse -Filter python.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($localPython) {
    $python = [PSCustomObject]@{ Source = $localPython.FullName }
  }
}
if (-not $python) {
  throw "python or py launcher was not found."
}

$root = Join-Path $env:TEMP "word-cloud-ipcam-hls"
$out = Join-Path $root "ipcam"
New-Item -ItemType Directory -Force -Path $out | Out-Null
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $out "*.m3u8"), (Join-Path $out "*.ts")

$ffmpegArgs = @(
  "-hide_banner",
  "-loglevel", "warning",
  "-rtsp_transport", "tcp",
  "-analyzeduration", "20000000",
  "-probesize", "20000000",
  "-i", $RtspUrl,
  "-an",
  "-c:v", "copy",
  "-f", "hls",
  "-hls_time", "1",
  "-hls_list_size", "6",
  "-hls_flags", "delete_segments+append_list+omit_endlist",
  "-hls_segment_filename", (Join-Path $out "seg_%05d.ts"),
  (Join-Path $out "index.m3u8")
)

Write-Host "Starting RTSP to HLS bridge..."
Write-Host "HLS URL: http://127.0.0.1:$Port/ipcam/index.m3u8"
Write-Host "Dashboard: https://jnfakimo.github.io/word-cloud/system/dashboard.html"

$ffmpegProcess = Start-Process -FilePath $ffmpeg.Source -ArgumentList $ffmpegArgs -PassThru -WindowStyle Hidden
try {
  & $python.Source (Join-Path $PSScriptRoot "cors-hls-server.py") --root $root --port $Port
}
finally {
  if ($ffmpegProcess -and -not $ffmpegProcess.HasExited) {
    Stop-Process -Id $ffmpegProcess.Id -Force
  }
}
