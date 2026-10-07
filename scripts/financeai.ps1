param(
  [ValidateSet(
    "setup",
    "web",
    "android-emulator",
    "android-phone",
    "ios-simulator",
    "docker",
    "docker-build",
    "test",
    "apk",
    "preview-apk",
    "production-aab",
    "netlify-preview",
    "netlify-production"
  )]
  [string]$Action = "setup",
  [string]$ApiUrl = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

switch ($Action) {
  "setup" {
    & (Join-Path $PSScriptRoot "setup.ps1")
  }
  "web" {
    & (Join-Path $PSScriptRoot "run.ps1") -Mode web
  }
  "android-emulator" {
    & (Join-Path $PSScriptRoot "run.ps1") -Mode android-emulator
  }
  "android-phone" {
    & (Join-Path $PSScriptRoot "run.ps1") -Mode android-phone
  }
  "ios-simulator" {
    & (Join-Path $PSScriptRoot "run.ps1") -Mode ios-simulator
  }
  "docker" {
    & (Join-Path $PSScriptRoot "run-docker.ps1")
  }
  "docker-build" {
    & (Join-Path $PSScriptRoot "run-docker.ps1") -Build
  }
  "test" {
    if (Test-Path ".venv\Scripts\python.exe") {
      & ".venv\Scripts\python.exe" -m pytest -q
      & ".venv\Scripts\python.exe" -m flake8 .
    } else {
      python -m pytest -q
      python -m flake8 .
    }
    Push-Location "mobile"
    try {
      npm run typecheck
      npx expo-doctor
    } finally {
      Pop-Location
    }
  }
  "apk" {
    & (Join-Path $PSScriptRoot "build-android.ps1") -Profile development
  }
  "preview-apk" {
    & (Join-Path $PSScriptRoot "build-android.ps1") -Profile preview
  }
  "production-aab" {
    & (Join-Path $PSScriptRoot "build-android.ps1") -Profile production
  }
  "netlify-preview" {
    & (Join-Path $PSScriptRoot "deploy-netlify.ps1") -ApiUrl $ApiUrl
  }
  "netlify-production" {
    & (Join-Path $PSScriptRoot "deploy-netlify.ps1") -Production -ApiUrl $ApiUrl
  }
}
