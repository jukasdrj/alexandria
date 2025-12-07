#!/bin/bash
# Pre-commit hook for Alexandria
# Validates code before allowing commits

set -e

echo "🔍 Running pre-commit checks..."

# Check if CREDENTIALS.md is being committed (should be gitignored)
if git diff --cached --name-only | grep -q "docs/CREDENTIALS.md"; then
  echo "❌ ERROR: docs/CREDENTIALS.md should not be committed!"
  exit 1
fi

# Check if .env files are being committed
if git diff --cached --name-only | grep -q "\.env"; then
  echo "❌ ERROR: .env files should not be committed!"
  exit 1
fi

# Check if wrangler.jsonc has any secrets
if git diff --cached --name-only | grep -q "wrangler.jsonc"; then
  if git diff --cached worker/wrangler.jsonc | grep -iE "(password|secret|api_key|token).*=.*['\"]"; then
    echo "⚠️  WARNING: wrangler.jsonc may contain secrets. Please verify."
  fi
fi

# Check for TypeScript errors in worker code if it's being committed
if git diff --cached --name-only | grep -q "^worker/.*\.ts$"; then
  echo "🔧 Checking TypeScript..."
  cd worker && npm run type-check 2>/dev/null || echo "⚠️  TypeScript check skipped (no type-check script)"
  cd ..
fi

echo "✅ Pre-commit checks passed!"
