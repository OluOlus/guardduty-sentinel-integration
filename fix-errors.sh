#!/bin/bash

echo "🔧 Applying systematic fixes..."

# Fix error logging patterns
echo "Fixing error logging patterns..."
find src -name "*.ts" -exec sed -i 's/{ error: errorMessage }/{ message: errorMessage }/g' {} \;
find src -name "*.ts" -exec sed -i 's/{ error: /{ message: /g' {} \;

# Fix callback parameter types
echo "Fixing callback parameter types..."
find src -name "*.ts" -exec sed -i 's/(c) => c\.status/(c: any) => c.status/g' {} \;

# Fix Express response methods
echo "Fixing Express response methods..."
find src -name "*.ts" -exec sed -i 's/\.text(/\.send(/g' {} \;

# Fix remaining HealthCheck references
echo "Fixing HealthCheck references..."
find src -name "*.ts" -exec sed -i 's/: HealthCheck/: HealthCheckSystem/g' {} \;
find src -name "*.ts" -exec sed -i 's/new HealthCheck(/new HealthCheckSystem(/g' {} \;

echo "✅ Systematic fixes applied!"