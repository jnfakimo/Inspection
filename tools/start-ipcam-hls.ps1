param(
  [string]$RtspUrl = $env:IPCAM_RTSP_URL,
  [int]$Port = 8091,
  [int]$Width = 480,
  [int]$Fps = 10,
  [string]$VideoBitrate = "450k"
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

function Clear-HlsOutput {
  Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $out "*.m3u8"), (Join-Path $out "*.ts")
}

function New-FfmpegArgs {
  $gop = [Math]::Max(1, $Fps * 2)
  $maxRateNumber = [int]([regex]::Match($VideoBitrate, "\d+").Value)
  $maxRate = "$([int]($maxRateNumber * 1.2))k"
  $bufSize = "$([int]($maxRateNumber * 2))k"
  @(
    "-hide_banner",
    "-loglevel", "warning",
    "-fflags", "+genpts",
    "-use_wallclock_as_timestamps", "1",
    "-rtsp_transport", "tcp",
    "-analyzeduration", "20000000",
    "-probesize", "20000000",
    "-i", $RtspUrl,
    "-an",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-tune", "zerolatency",
    "-profile:v", "baseline",
    "-level", "3.0",
    "-pix_fmt", "yuv420p",
    "-vf", "scale=${Width}:-2:flags=fast_bilinear,fps=${Fps}",
    "-b:v", $VideoBitrate,
    "-maxrate", $maxRate,
    "-bufsize", $bufSize,
    "-g", "$gop",
    "-keyint_min", "$gop",
    "-sc_threshold", "0",
    "-f", "hls",
    "-hls_time", "2",
    "-hls_list_size", "8",
    "-hls_flags", "delete_segments+omit_endlist+program_date_time+independent_segments",
    "-hls_segment_filename", (Join-Path $out "seg_%05d.ts"),
    (Join-Path $out "index.m3u8")
  )
}

function Start-FfmpegBridge {
  Clear-HlsOutput
  Start-Process -FilePath $ffmpeg.Source -ArgumentList (New-FfmpegArgs) -PassThru -WindowStyle Hidden
}

Write-Host "Starting RTSP to HLS bridge..."
Write-Host "HLS URL: http://127.0.0.1:$Port/ipcam/index.m3u8"
Write-Host "Dashboard: https://jnfakimo.github.io/word-cloud/system/dashboard.html"
Write-Host "The bridge will restart ffmpeg automatically if the stream stops updating."

$serverArgs = @((Join-Path $PSScriptRoot "cors-hls-server.py"), "--root", $root, "--port", "$Port")
$serverProcess = Start-Process -FilePath $python.Source -ArgumentList $serverArgs -PassThru -WindowStyle Hidden
$ffmpegProcess = $null
try {
  while ($true) {
    $ffmpegProcess = Start-FfmpegBridge
    $startedAt = Get-Date
    $playlist = Join-Path $out "index.m3u8"
    Write-Host "ffmpeg started. PID: $($ffmpegProcess.Id)"

    while (-not $ffmpegProcess.HasExited) {
      Start-Sleep -Seconds 5

      if (Test-Path $playlist) {
        $ageSeconds = ((Get-Date) - (Get-Item $playlist).LastWriteTime).TotalSeconds
        if ($ageSeconds -gt 25) {
          Write-Warning "HLS playlist has not updated for $([int]$ageSeconds) seconds. Restarting ffmpeg..."
          Stop-Process -Id $ffmpegProcess.Id -Force -ErrorAction SilentlyContinue
          break
        }
      }
      elseif (((Get-Date) - $startedAt).TotalSeconds -gt 45) {
        Write-Warning "HLS playlist was not created after 45 seconds. Restarting ffmpeg..."
        Stop-Process -Id $ffmpegProcess.Id -Force -ErrorAction SilentlyContinue
        break
      }
    }

    if ($ffmpegProcess.HasExited) {
      Write-Warning "ffmpeg exited with code $($ffmpegProcess.ExitCode). Restarting in 3 seconds..."
    }
    Start-Sleep -Seconds 3
  }
}
finally {
  if ($ffmpegProcess -and -not $ffmpegProcess.HasExited) {
    Stop-Process -Id $ffmpegProcess.Id -Force
  }
  if ($serverProcess -and -not $serverProcess.HasExited) {
    Stop-Process -Id $serverProcess.Id -Force
  }
}
