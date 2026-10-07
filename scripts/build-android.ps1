param(
  [ValidateSet("development","preview","production")]
  [string]$Profile = "development"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $Root "mobile")

if (-not (Get-Command eas -ErrorAction SilentlyContinue)) {
  npm install --global eas-cli
}

eas whoami
if ($LASTEXITCODE -ne 0) { throw "Run: eas login" }

npm install
npx expo install --fix
npm run typecheck
npx expo-doctor

eas build --platform android --profile $Profile
