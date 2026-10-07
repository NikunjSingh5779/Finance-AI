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
  & (Join-Path $venv "Scripts\pip.exe") install -r (Join-Path $Root "requirements.txt")
  if (-not (Test-Path (Join-Path $Root ".env"))) {
    Copy-Item (Join-Path $Root ".env.example") (Join-Path $Root ".env")
  }
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
