param(
  [switch]$Production,
  [string]$ApiUrl = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Get-Command netlify -ErrorAction SilentlyContinue)) {
  npm install --global netlify-cli
}

$env:NETLIFY_SITE_ID = "d41e9b15-4af3-410e-87f5-47d27e8378ca"

if ($ApiUrl.Trim()) {
  $env:FINANCEAI_API_URL = $ApiUrl.Trim().TrimEnd("/")
}

netlify status
netlify build

if ($Production) {
  netlify deploy --prod
} else {
  netlify deploy
}
