# ============================================================================
# OpenTerminalUI — one-command installer for Windows (PowerShell).
#
#   ./install.ps1                 # auto-detect: Docker if available, else local
#   $env:OTUI_MODE="docker"; ./install.ps1
#   $env:OTUI_MODE="local";  ./install.ps1
#
# Mirrors install.sh: creates a single .env, auto-generates secrets + a unique
# admin password, seeds the admin account, builds & launches at
# http://localhost:8000, and prints the credentials.
# ============================================================================
$ErrorActionPreference = "Stop"

$RootDir = $PSScriptRoot
Set-Location $RootDir
$EnvFile = Join-Path $RootDir ".env"
$Port = if ($env:APP_PORT) { $env:APP_PORT } else { "8000" }

function Write-Cyan($m)  { Write-Host $m -ForegroundColor Cyan }
function Write-Green($m) { Write-Host $m -ForegroundColor Green }
function Write-Yellow($m){ Write-Host $m -ForegroundColor Yellow }

function Get-PyBin {
  foreach ($c in @("python", "python3", "py")) {
    if (Get-Command $c -ErrorAction SilentlyContinue) { return $c }
  }
  return $null
}

function New-Secret {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
}

function Get-EnvVar($key) {
  if (-not (Test-Path $EnvFile)) { return "" }
  $line = Select-String -Path $EnvFile -Pattern "^$key=" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($line) { return ($line.Line -replace "^$key=", "") }
  return ""
}

function Set-EnvVar($key, $value) {
  $content = if (Test-Path $EnvFile) { Get-Content $EnvFile } else { @() }
  if ($content -match "^$key=") {
    $content = $content | ForEach-Object { if ($_ -match "^$key=") { "$key=$value" } else { $_ } }
  } else {
    $content += "$key=$value"
  }
  Set-Content -Path $EnvFile -Value $content
}

function Initialize-EnvVar($key, $value) {
  if ([string]::IsNullOrEmpty((Get-EnvVar $key))) { Set-EnvVar $key $value }
}

Write-Cyan "==> OpenTerminalUI installer (Windows)"

$PyBin = Get-PyBin
Write-Green "    detected OS: windows  (python: $(if ($PyBin) { $PyBin } else { 'not found' }))"

# --- 1. Ensure single .env exists -----------------------------------------
if (-not (Test-Path $EnvFile)) {
  Copy-Item (Join-Path $RootDir ".env.example") $EnvFile
  Write-Green "    created .env from .env.example"
} else {
  Write-Yellow "    .env already exists - keeping your values, filling blanks only"
}

# --- 2. Auto-fill secrets + admin -----------------------------------------
Initialize-EnvVar "JWT_SECRET_KEY"    (New-Secret)
Initialize-EnvVar "CACHE_SIGNING_KEY" (New-Secret)
Initialize-EnvVar "BOOTSTRAP_ADMIN_EMAIL" "admin@openterminal.local"

$AdminPass = Get-EnvVar "BOOTSTRAP_ADMIN_PASSWORD"
if ([string]::IsNullOrEmpty($AdminPass)) {
  $AdminPass = (New-Secret).Substring(0, 20)
  Set-EnvVar "BOOTSTRAP_ADMIN_PASSWORD" $AdminPass
}
$AdminEmail = Get-EnvVar "BOOTSTRAP_ADMIN_EMAIL"
Write-Green "    secrets + admin account configured"

# --- 3. Pick a run mode ----------------------------------------------------
$Mode = if ($env:OTUI_MODE) { $env:OTUI_MODE } else { "auto" }
if ($Mode -eq "auto") {
  # `docker compose version` works even with the daemon stopped, so also require
  # `docker info` (a running daemon) before choosing Docker.
  $dockerCli = [bool](Get-Command docker -ErrorAction SilentlyContinue)
  $daemonUp = $false
  if ($dockerCli) { & docker info 2>$null | Out-Null; $daemonUp = $? }
  if ($dockerCli -and -not $daemonUp) {
    Write-Yellow "    Docker is installed but its daemon isn't running - falling back to local mode."
  }
  $Mode = if ($dockerCli -and $daemonUp) { "docker" } else { "local" }
}
Write-Cyan "==> install mode: $Mode"

function Show-Credentials {
  Write-Host ""
  Write-Green "============================================================"
  Write-Green " OpenTerminalUI is ready  ->  http://localhost:$Port"
  Write-Green "------------------------------------------------------------"
  Write-Green "  Log in with:"
  Write-Green "    email:    $AdminEmail"
  Write-Green "    password: $AdminPass"
  Write-Green "  (also saved in your .env - change it after first login)"
  Write-Green "============================================================"
  Write-Host ""
  Write-Cyan  "  Add API keys any time with:  ./scripts/setup-keys.sh"
}

if ($Mode -eq "docker") {
  Write-Green "    building & starting containers (docker compose)..."
  & docker compose --env-file $EnvFile up -d --build
  Start-Process "http://localhost:$Port"
  Show-Credentials
} else {
  if (-not $PyBin) { Write-Yellow "Python not found; install Python 3.11+"; exit 1 }
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Write-Yellow "npm not found; install Node 20+"; exit 1 }

  Write-Green "    setting up Python backend..."
  if (-not (Test-Path (Join-Path $RootDir ".venv"))) { & $PyBin -m venv (Join-Path $RootDir ".venv") }
  $VenvPy = Join-Path $RootDir ".venv\Scripts\python.exe"
  & $VenvPy -m pip install --quiet --upgrade pip
  & $VenvPy -m pip install --quiet -r (Join-Path $RootDir "backend\requirements.txt")

  Write-Green "    building frontend..."
  Push-Location (Join-Path $RootDir "frontend"); & npm ci; & npm run build; Pop-Location

  Write-Green "    running database migrations..."
  $env:PYTHONPATH = $RootDir
  & $VenvPy -m alembic -c (Join-Path $RootDir "backend\alembic.ini") upgrade head

  Write-Green "    seeding admin account..."
  & $VenvPy (Join-Path $RootDir "scripts\seed_admin.py")

  Show-Credentials
  Start-Process "http://localhost:$Port"
  Write-Green "    starting server at http://localhost:$Port (Ctrl+C to stop)..."
  & $VenvPy -m uvicorn backend.main:app --host 0.0.0.0 --port $Port
}
