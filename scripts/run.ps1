param(
  [ValidateSet("web","android-emulator","android-phone","ios-simulator")]
  [string]$Mode = "web",
  [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$python = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
  $python = (Get-Command python -ErrorAction SilentlyContinue).Source
}
if (-not $python) {
  throw "Python not found. Run .\scripts\setup.ps1 first."
}

if (-not (Test-Path (Join-Path $Root ".env"))) {
  Copy-Item (Join-Path $Root ".env.example") (Join-Path $Root ".env")
}

$env:CORS_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000,http://localhost:8081,http://127.0.0.1:8081"
$env:CORS_ORIGIN_REGEX = '^https?://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$'

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

switch ($Mode) {
  "web" {
    Start-Process "$backendUrl/"
    Write-Host "Web: $backendUrl/" -ForegroundColor Green
  }

  "android-emulator" {
    Push-Location (Join-Path $Root "mobile")
    try {
      Set-Content ".env.local" "EXPO_PUBLIC_API_URL=http://10.0.2.2:$Port"
      npx expo start --android
    } finally {
      Pop-Location
    }
  }

  "android-phone" {
    $route = Get-NetRoute -DestinationPrefix "0.0.0.0/0" |
      Sort-Object RouteMetric, InterfaceMetric |
      Select-Object -First 1

    $lan = $null
    if ($route) {
      $lan = Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 |
        Where-Object { $_.IPAddress -notmatch "^(127\.|169\.254\.)" } |
        Select-Object -First 1 -ExpandProperty IPAddress
    }

    if (-not $lan) {
      throw "Could not determine the active LAN IPv4 address. Use ipconfig and set the URL in mobile Settings."
    }

    $phoneUrl = "http://" + $lan + ":" + $Port

    Push-Location (Join-Path $Root "mobile")
    try {
      Set-Content ".env.local" "EXPO_PUBLIC_API_URL=$phoneUrl"
      Write-Host "Phone backend URL: $phoneUrl" -ForegroundColor Green
      npx expo start
    } finally {
      Pop-Location
    }
  }

  "ios-simulator" {
    Push-Location (Join-Path $Root "mobile")
    try {
      Set-Content ".env.local" "EXPO_PUBLIC_API_URL=http://127.0.0.1:$Port"
      npx expo start --ios
    } finally {
      Pop-Location
    }
  }
}
