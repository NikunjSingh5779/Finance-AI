param(
  [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$python = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
  $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
  if (-not $pythonCommand) {
    throw "Python not found. Run .\scripts\setup.ps1 first."
  }
  $python = $pythonCommand.Source
}

if (-not (Test-Path (Join-Path $Root ".env"))) {
  Copy-Item (Join-Path $Root ".env.example") (Join-Path $Root ".env")
}

$env:CORS_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000"
$backendUrl = "http://127.0.0.1:$Port"

$existingListener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $existingListener) {
  Start-Process -FilePath $python -ArgumentList "-m uvicorn app.main:app --host 0.0.0.0 --port $Port" -WorkingDirectory $Root
  Write-Host "Started FinanceAI backend on port $Port" -ForegroundColor Cyan
} else {
  Write-Host "Reusing existing listener on port $Port" -ForegroundColor Yellow
}

$healthy = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  try {
    $response = Invoke-RestMethod "$backendUrl/health"
    if ($response.status -eq "ok") {
      $healthy = $true
      break
    }
  } catch {}
}

if (-not $healthy) {
  throw "Backend did not become healthy at $backendUrl"
}

Start-Process "$backendUrl/"
Write-Host "FinanceAI PWA: $backendUrl/" -ForegroundColor Green
