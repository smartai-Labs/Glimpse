#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
npm run check
node scripts/verify-build.cjs
version="$(node -p "require('./package.json').version")"
zip_name="glimpse-${version}.zip"
# Only replace this version's generated package in the project directory.
if [ -f "$zip_name" ]; then rm -- "$zip_name"; fi
(cd dist && zip -qr "../$zip_name" .)
echo "Created $zip_name"
