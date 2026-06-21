#!/bin/bash

# ==============================================================================
# Pixel Dungeon Production Deployment Script (Server-Side)
# ==============================================================================

set -e

echo "[INFO] Starting Pixel Dungeon Deployment..."

# 1. Git Sync
echo "[INFO] Pulling latest code..."
# Ensure the repository is tracking origin main correctly
git fetch origin main
git reset --hard origin/main

# 2. Build Client
echo "[INFO] Installing dependencies..."
npm install -s

echo "[INFO] Building static assets..."
npm run build

# 3. Deploy Built Assets to Web Directory
echo "[INFO] Copying assets to /var/www/pixel-dungeon/..."
mkdir -p /var/www/pixel-dungeon
rm -rf /var/www/pixel-dungeon/*
cp -r dist/* /var/www/pixel-dungeon/

# 4. Set Permissions
echo "[INFO] Setting permissions..."
chown -R www-data:www-data /var/www/pixel-dungeon
chmod -R 755 /var/www/pixel-dungeon

echo "[SUCCESS] PIXEL DUNGEON DEPLOYMENT COMPLETE"
