param(
  [ValidateSet(
    "setup",
    "web",
    "docker",
    "docker-build",
    "test",
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
    & (Join-Path $PSScriptRoot "run.ps1")
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
      & ".venv\Scripts\python.exe" -m flake8 app tests
    } else {
      python -m pytest -q
      python -m flake8 app tests
    }
    node --check app/static/app.js
    node --check app/static/pwa.js
    node --check app/static/sw.js
    node scripts/build-netlify.mjs
  }
  "netlify-preview" {
    & (Join-Path $PSScriptRoot "deploy-netlify.ps1") -ApiUrl $ApiUrl
  }
  "netlify-production" {
    & (Join-Path $PSScriptRoot "deploy-netlify.ps1") -Production -ApiUrl $ApiUrl
  }
}
