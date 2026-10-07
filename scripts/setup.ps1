param(
  [switch]$SkipMobile,
  [switch]$SkipPython
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not $SkipPython) {
  if (-not (Get-Command python -ErrorAction SilentlyContinue)) { throw "Python is not installed or not on PATH." }
  $venv = Join-Path $Root ".venv"
  if (-not (Test-Path $venv)) { python -m venv $venv }
  & (Join-Path $venv "Scripts\python.exe") -m pip install --upgrade pip
  & (Join-Path $venv "Scripts\pip.exe") install -r (Join-Path $Root "requirements-dev.txt")
  if (-not (Test-Path (Join-Path $Root ".env"))) {
    Copy-Item (Join-Path $Root ".env.example") (Join-Path $Root ".env")
  }

  $envPath = Join-Path $Root ".env"
  $envText = Get-Content $envPath -Raw
  $corsOrigins = "CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,http://localhost:8081,http://127.0.0.1:8081"
  $corsRegex = 'CORS_ORIGIN_REGEX=^https?://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?
}

if (-not $SkipMobile) {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js is not installed or not on PATH." }
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "npm is not installed or not on PATH." }
  Push-Location (Join-Path $Root "mobile")
  try {
    if (Test-Path "node_modules") {
      Remove-Item "node_modules" -Recurse -Force
    }
    if (Test-Path "package-lock.json") {
      Remove-Item "package-lock.json" -Force
    }
    npm install --prefer-dedupe
    npm dedupe
    npx expo install --fix
    npm dedupe
    npm run typecheck
    npx expo-doctor
  } finally { Pop-Location }
}

Write-Host "FinanceAI setup complete." -ForegroundColor Green

  $newline = [Environment]::NewLine

  if ($envText -match '(?m)^CORS_ORIGINS=.*
}

if (-not $SkipMobile) {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js is not installed or not on PATH." }
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "npm is not installed or not on PATH." }
  Push-Location (Join-Path $Root "mobile")
  try {
    npm install
    npx expo install --fix
    npm run typecheck
    npx expo-doctor
  } finally { Pop-Location }
}

Write-Host "FinanceAI setup complete." -ForegroundColor Green
) {
    $envText = [regex]::Replace($envText, '(?m)^CORS_ORIGINS=.*
}

if (-not $SkipMobile) {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js is not installed or not on PATH." }
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "npm is not installed or not on PATH." }
  Push-Location (Join-Path $Root "mobile")
  try {
    npm install
    npx expo install --fix
    npm run typecheck
    npx expo-doctor
  } finally { Pop-Location }
}

Write-Host "FinanceAI setup complete." -ForegroundColor Green
, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $corsOrigins })
  } else {
    $envText = $envText.TrimEnd() + $newline + $corsOrigins + $newline
  }

  if ($envText -match '(?m)^CORS_ORIGIN_REGEX=.*
}

if (-not $SkipMobile) {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js is not installed or not on PATH." }
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "npm is not installed or not on PATH." }
  Push-Location (Join-Path $Root "mobile")
  try {
    npm install
    npx expo install --fix
    npm run typecheck
    npx expo-doctor
  } finally { Pop-Location }
}

Write-Host "FinanceAI setup complete." -ForegroundColor Green
) {
    $envText = [regex]::Replace($envText, '(?m)^CORS_ORIGIN_REGEX=.*
}

if (-not $SkipMobile) {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js is not installed or not on PATH." }
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "npm is not installed or not on PATH." }
  Push-Location (Join-Path $Root "mobile")
  try {
    npm install
    npx expo install --fix
    npm run typecheck
    npx expo-doctor
  } finally { Pop-Location }
}

Write-Host "FinanceAI setup complete." -ForegroundColor Green
, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $corsRegex })
  } else {
    $envText = $envText.TrimEnd() + $newline + $corsRegex + $newline
  }

  Set-Content -Path $envPath -Value $envText
}

if (-not $SkipMobile) {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js is not installed or not on PATH." }
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "npm is not installed or not on PATH." }
  Push-Location (Join-Path $Root "mobile")
  try {
    npm install
    npx expo install --fix
    npm run typecheck
    npx expo-doctor
  } finally { Pop-Location }
}

Write-Host "FinanceAI setup complete." -ForegroundColor Green
