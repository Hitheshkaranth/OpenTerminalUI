param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ForgeArgs
)

$projectRoot = Split-Path -Parent $PSScriptRoot
$shimPath = Join-Path $projectRoot ".forge\bin"
$env:PATH = "$shimPath;$env:PATH"

& forge.exe @ForgeArgs
exit $LASTEXITCODE
