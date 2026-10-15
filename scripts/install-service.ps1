# PowerShell: install the ERP backend as a Windows service via nssm
# Run as Administrator from the erp/Backend directory.
# Usage: .\install-service.ps1 -BackendDir "C:\erp\Backend" -ServiceName "ERP"

param(
    [Parameter(Mandatory=$true)] [string] $BackendDir,
    [string] $ServiceName = "ERP",
    [int] $Port = 4000
)

$ErrorActionPreference = "Stop"

# Locate Node
$nodePath = (Get-Command node).Source
if (-not $nodePath) { throw "Node.js is not on PATH. Install Node.js 20 LTS first." }
Write-Host "Node: $nodePath"

# Locate nssm
$nssm = (Get-Command nssm -ErrorAction SilentlyContinue).Source
if (-not $nssm) {
    Write-Host "nssm not found. Install via: choco install nssm -y"
    throw "nssm is required."
}

$entry = Join-Path $BackendDir "dist\index.js"
if (-not (Test-Path $entry)) { throw "Build output not found at $entry. Run 'npm run build' first." }

# Install service
& $nssm install $ServiceName $nodePath $entry
& $nssm set $ServiceName AppDirectory $BackendDir
& $nssm set $ServiceName AppEnvironmentExtra "NODE_ENV=production" "PORT=$Port"
& $nssm set $ServiceName AppStdout (Join-Path $BackendDir "logs\stdout.log")
& $nssm set $ServiceName AppStderr  (Join-Path $BackendDir "logs\stderr.log")
& $nssm set $ServiceName AppRotateFiles 1
& $nssm set $ServiceName AppRotateOnline 1
& $nssm set $ServiceName AppRotateBytes 10485760

& $nssm start $ServiceName
Write-Host "Service '$ServiceName' installed and started on port $Port."
