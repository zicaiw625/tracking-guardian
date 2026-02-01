#!/bin/bash
set -e

echo "🔍 Checking environment..."
node -v
pnpm -v

echo "🧹 Cleaning up..."
rm -rf node_modules
rm -rf extensions/*/node_modules
rm -rf pnpm-lock.yaml

echo "📦 Installing dependencies..."
pnpm install

echo "✨ Generating Prisma client..."
pnpm generate

echo "✅ Installation fixed!"
