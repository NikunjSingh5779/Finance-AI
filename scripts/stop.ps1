$ErrorActionPreference = "SilentlyContinue"

$processes = Get-CimInstance Win32_Process |
  Where-Object {
    $_.CommandLine -match "uvicorn app\.main:app" -or
    $_.CommandLine -match "expo (start|start --)" -or
    $_.CommandLine -match "react-native"
  }

foreach ($process in $processes) {
  Stop-Process -Id $process.ProcessId -Force
}

Write-Host "FinanceAI local backend/mobile processes stopped." -ForegroundColor Green
