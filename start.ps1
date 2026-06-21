param(
  [string]$HostName = "127.0.0.1",
  [int]$Port = 5173
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

Write-Host "Starting Pixel Dungeon from $Root"

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  throw "npm was not found on PATH. Install Node.js, then rerun this script."
}

if (-not (Test-Path (Join-Path $Root "node_modules"))) {
  Write-Host "node_modules not found; installing dependencies..."
  npm.cmd install
}

Write-Host "Launching Vite dev server at http://$HostName`:$Port/ ..."
npm.cmd run dev -- --host $HostName --port $Port
