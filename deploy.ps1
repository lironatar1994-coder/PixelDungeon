param (
    [string]$CommitMessage = ""
)

$ErrorActionPreference = "Stop"

Write-Host "--- Starting Pixel Dungeon Deployment ---" -ForegroundColor Cyan

$SSH_HOST = "root@vee-app.co.il"

# 1. Pre-flight Check
Write-Host "Checking server connectivity..." -ForegroundColor Gray
if (-not (Test-Connection -ComputerName "vee-app.co.il" -Count 1 -Quiet)) {
    Write-Host "Error: Could not ping server vee-app.co.il." -ForegroundColor Red
    exit 1
}

# 2. Git Workflow
$status = git status --porcelain
if ($status) {
    $Message = $CommitMessage
    if (-not $Message) {
        $Message = Read-Host "Changes detected. Enter commit message"
    }
    if (-not $Message) { $Message = "Deployment update" }
    
    Write-Host "Staging and committing changes..." -ForegroundColor Gray
    git add .
    git commit -m "$Message"
}

Write-Host "Pushing to GitHub..." -ForegroundColor Gray
git push origin main

# 3. Trigger Remote Deployment
Write-Host "Connecting to server and triggering remote deploy..." -ForegroundColor Blue
$REMOTE_CMD = "cd /root/PixelDungeon && chmod +x deploy_linux.sh && ./deploy_linux.sh"

ssh $SSH_HOST $REMOTE_CMD

if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[!] DEPLOYMENT FAILED" -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "`n================================================" -ForegroundColor Green
Write-Host "      DEPLOYMENT COMPLETE SUCCESSFULLY" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
