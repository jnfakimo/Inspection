param(
  [string]$RtspUrl = $env:IPCAM_RTSP_URL,
  [int]$Port = 8091
)

$ErrorActionPreference = "Stop"

if (-not $RtspUrl) {
  $RtspUrl = Read-Host "RTSP URL, for example rtsp://admin:password@1.34.250.22:10273/channel1"
}

$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ffmpeg) {
  throw "ffmpeg was not found in PATH."
}

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
  throw "python was not found in PATH."
}

$root = Join-Path $env:TEMP "word-cloud-ipcam-hls"
$out = Join-Path $root "ipcam"
New-Item -ItemType Directory -Force -Path $out | Out-Null
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $out "*.m3u8"), (Join-Path $out "*.ts")

$ffmpegArgs = @(
  "-hide_banner",
  "-loglevel", "warning",
  "-rtsp_transport", "tcp",
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
  Push-Location $root
  python -m http.server $Port --bind 127.0.0.1
}
finally {
  Pop-Location
  if ($ffmpegProcess -and -not $ffmpegProcess.HasExited) {
    Stop-Process -Id $ffmpegProcess.Id -Force
  }
}
