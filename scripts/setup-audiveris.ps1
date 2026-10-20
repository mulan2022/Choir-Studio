$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$tools = Join-Path $root 'tools'
$installer = Join-Path $tools 'audiveris.msi'
$target = Join-Path $tools 'audiveris'
$binary = Join-Path $target 'Audiveris\Audiveris.exe'
if (Test-Path -LiteralPath $binary) {
  Write-Host "Audiveris already available: $binary"
  exit 0
}
New-Item -ItemType Directory -Force -Path $tools | Out-Null
if (-not (Test-Path -LiteralPath $installer)) {
  Write-Host 'Downloading Audiveris 5.11.0 (about 85 MB)...'
  Invoke-WebRequest -Uri 'https://github.com/Audiveris/audiveris/releases/download/5.11.0/Audiveris-5.11.0-windowsConsole-x86_64.msi' -OutFile $installer
}
Write-Host 'Extracting Audiveris into the project tools directory...'
$process = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/a', $installer, '/qn', "TARGETDIR=$target") -PassThru -Wait -WindowStyle Hidden
if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $binary)) {
  throw "Audiveris extraction failed (exit code $($process.ExitCode))."
}
Write-Host "Audiveris ready: $binary"
