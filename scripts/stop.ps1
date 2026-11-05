$ErrorActionPreference = "SilentlyContinue"

$processes = Get-CimInstance Win32_Process |
  Where-Object {
    $_.CommandLine -match "uvicorn app\.main:app"
  }

foreach ($process in $processes) {
  Stop-Process -Id $process.ProcessId -Force
}

Write-Host "FinanceAI backend process stopped." -ForegroundColor Green
