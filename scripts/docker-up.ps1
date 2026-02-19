param(
  [switch]$Redis,
  [switch]$Postgres,
  [switch]$NoDetach,
  [int]$Port = 8000
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
Set-Location $repoRoot

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

function Invoke-Docker {
  param(
    [string[]]$DockerArgs,
    [switch]$Quiet
  )
  if ($Quiet) {
    & docker @DockerArgs *> $null
  } else {
    & docker @DockerArgs
  }
  if ($LASTEXITCODE -ne 0) {
    throw ("docker " + ($DockerArgs -join " ") + " failed with exit code $LASTEXITCODE")
  }
}

Require-Command docker

Invoke-Docker -DockerArgs @("compose", "version") -Quiet
Invoke-Docker -DockerArgs @("info") -Quiet
$composeUpHelp = (& docker compose up --help) | Out-String
$supportsWait = $composeUpHelp -match "(^|\s)--wait(\s|$)"

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created .env from .env.example"
}

if ($Port -lt 1 -or $Port -gt 65535) {
  throw "Invalid port: $Port. Use a value between 1 and 65535."
}

$portInUse = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($portInUse) {
  throw "Port $Port is already in use. Re-run with -Port <free_port>, e.g. -Port 8010."
}

$env:APP_PORT = "$Port"

if ($Redis) {
  $envLines = Get-Content ".env" -ErrorAction Stop
  $hasRedis = $false
  foreach ($line in $envLines) {
    if ($line -match "^REDIS_URL=") {
      $hasRedis = $true
      break
    }
  }
  if (-not $hasRedis) {
    Add-Content ".env" "REDIS_URL=redis://redis:6379/0"
  }
}

$args = @("compose")
if ($Redis) { $args += @("--profile", "redis") }
if ($Postgres) { $args += @("--profile", "postgres") }
$args += @("up", "--build")
if (-not $NoDetach) {
  $args += "-d"
  if ($supportsWait) { $args += "--wait" }
}

Write-Host ("Running: docker " + ($args -join " "))
Invoke-Docker -DockerArgs $args

Write-Host ""
Write-Host "Open http://127.0.0.1:$Port"
Write-Host "API docs: http://127.0.0.1:$Port/docs"
