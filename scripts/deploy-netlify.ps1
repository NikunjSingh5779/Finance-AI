param([switch]$Production)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Get-Command netlify -ErrorAction SilentlyContinue)) {
  npm install --global netlify-cli
}

netlify status

if ($Production) {
  netlify deploy --prod --build
} else {
  netlify deploy --build
}
