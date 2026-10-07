param([switch]$Build)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker is not installed or not on PATH." }
if (-not (Test-Path ".env")) { Copy-Item ".env.example" ".env" }

if ($Build) { docker compose build }
docker compose up -d
Start-Sleep -Seconds 3
Invoke-RestMethod "http://127.0.0.1:8000/health"
Write-Host "FinanceAI Docker: http://127.0.0.1:8000" -ForegroundColor Green
