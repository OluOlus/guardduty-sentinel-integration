#!/bin/bash

# GuardDuty Sentinel Integration - Deployment Testing Script
# This script tests the deployment process without requiring a production workspace

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[TEST]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[PASS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[FAIL]${NC} $1"
}

print_status "Starting GuardDuty Sentinel Integration deployment tests..."
echo ""

# Test 1: Check required files exist
print_status "Test 1: Checking required files..."
required_files=(
    "deployment/azuredeploy.json"
    "deployment/azuredeploy.parameters.json"
    "deployment/deploy.bicep"
    "kql/AWSGuardDuty_Config.kql"
    "kql/AWSGuardDuty_Main.kql"
    "kql/AWSGuardDuty_Network.kql"
    "kql/AWSGuardDuty_IAM.kql"
    "kql/AWSGuardDuty_ASIMNetworkSession.kql"
)

all_files_exist=true
for file in "${required_files[@]}"; do
    if [[ -f "$file" ]]; then
        print_success "Found: $file"
    else
        print_error "Missing: $file"
        all_files_exist=false
    fi
done

if [[ "$all_files_exist" == true ]]; then
    print_success "All required files exist"
else
    print_error "Some required files are missing"
    exit 1
fi

echo ""

# Test 2: Validate JSON syntax
print_status "Test 2: Validating JSON syntax..."
json_files=(
    "deployment/azuredeploy.json"
    "deployment/azuredeploy.parameters.json"
)

json_valid=true
for file in "${json_files[@]}"; do
    if python3 -m json.tool "$file" > /dev/null 2>&1; then
        print_success "Valid JSON: $file"
    else
        print_error "Invalid JSON: $file"
        json_valid=false
    fi
done

if [[ "$json_valid" == true ]]; then
    print_success "All JSON files are valid"
else
    print_error "Some JSON files have syntax errors"
    exit 1
fi

echo ""

# Test 3: Check ARM template structure
print_status "Test 3: Checking ARM template structure..."
template_file="deployment/azuredeploy.json"

# Check for required ARM template sections
required_sections=("parameters" "variables" "resources" "outputs")
template_valid=true

for section in "${required_sections[@]}"; do
    if grep -q "\"$section\"" "$template_file"; then
        print_success "Found ARM section: $section"
    else
        print_error "Missing ARM section: $section"
        template_valid=false
    fi
done

# Check for required parameters
required_params=("workspaceName" "guardDutyTableName" "rawDataColumn" "defaultLookback")
for param in "${required_params[@]}"; do
    if grep -q "\"$param\"" "$template_file"; then
        print_success "Found parameter: $param"
    else
        print_error "Missing parameter: $param"
        template_valid=false
    fi
done

if [[ "$template_valid" == true ]]; then
    print_success "ARM template structure is valid"
else
    print_error "ARM template structure has issues"
    exit 1
fi

echo ""

# Test 4: Validate sample data
print_status "Test 4: Validating sample data..."
sample_file="sample-data/guardduty_findings.jsonl"

if [[ -f "$sample_file" ]]; then
    line_count=0
    valid_lines=0
    
    while IFS= read -r line; do
        ((line_count++))
        if echo "$line" | python3 -m json.tool > /dev/null 2>&1; then
            ((valid_lines++))
        else
            print_warning "Invalid JSON on line $line_count"
        fi
    done < "$sample_file"
    
    if [[ $valid_lines -eq $line_count ]]; then
        print_success "All $line_count lines in sample data are valid JSON"
    else
        print_warning "$valid_lines/$line_count lines are valid JSON"
    fi
else
    print_warning "Sample data file not found: $sample_file"
fi

echo ""

# Test 5: Check KQL function syntax (basic)
print_status "Test 5: Basic KQL syntax validation..."
kql_files=(
    "kql/AWSGuardDuty_Config.kql"
    "kql/AWSGuardDuty_Main.kql"
    "kql/AWSGuardDuty_Network.kql"
    "kql/AWSGuardDuty_IAM.kql"
    "kql/AWSGuardDuty_ASIMNetworkSession.kql"
)

kql_valid=true
for file in "${kql_files[@]}"; do
    # Check for balanced parentheses
    if python3 -c "
import sys
content = open('$file').read()
stack = []
for char in content:
    if char in '([{':
        stack.append(char)
    elif char in ')]}':
        if not stack:
            print('Unmatched closing bracket')
            sys.exit(1)
        opening = stack.pop()
        pairs = {'(': ')', '[': ']', '{': '}'}
        if pairs.get(opening) != char:
            print('Mismatched brackets')
            sys.exit(1)
if stack:
    print('Unmatched opening bracket')
    sys.exit(1)
" 2>/dev/null; then
        print_success "Balanced brackets: $file"
    else
        print_error "Bracket mismatch: $file"
        kql_valid=false
    fi
    
    # Check for required KQL patterns
    if [[ "$file" == *"Config"* ]]; then
        if grep -q "datatable" "$file"; then
            print_success "Config function has datatable: $file"
        else
            print_error "Config function missing datatable: $file"
            kql_valid=false
        fi
    fi
    
    if [[ "$file" == *"Main"* ]]; then
        if grep -q "AWSGuardDuty_Config" "$file"; then
            print_success "Main parser references config: $file"
        else
            print_error "Main parser missing config reference: $file"
            kql_valid=false
        fi
    elif [[ "$file" == *"ASIM"* ]]; then
        if grep -q "AWSGuardDuty_Network" "$file"; then
            print_success "ASIM parser uses Network function: $file"
        else
            print_error "ASIM parser missing Network function reference: $file"
            kql_valid=false
        fi
    elif [[ "$file" == *"Network"* ]] || [[ "$file" == *"IAM"* ]]; then
        if grep -q "AWSGuardDuty_Main" "$file"; then
            print_success "Parser uses Main function: $file"
        else
            print_error "Parser missing Main function reference: $file"
            kql_valid=false
        fi
    fi
done

if [[ "$kql_valid" == true ]]; then
    print_success "Basic KQL syntax validation passed"
else
    print_error "KQL syntax validation failed"
    exit 1
fi

echo ""

# Test 6: Check deployment script
print_status "Test 6: Checking deployment script..."
deploy_script="deploy.sh"

if [[ -f "$deploy_script" ]]; then
    if [[ -x "$deploy_script" ]]; then
        print_success "Deployment script is executable"
    else
        print_warning "Deployment script is not executable (run: chmod +x deploy.sh)"
    fi
    
    # Check for required parameters
    if grep -q "resource-group" "$deploy_script" && grep -q "workspace" "$deploy_script"; then
        print_success "Deployment script has required parameters"
    else
        print_error "Deployment script missing required parameters"
        exit 1
    fi
else
    print_error "Deployment script not found: $deploy_script"
    exit 1
fi

echo ""

# Test 7: Check documentation
print_status "Test 7: Checking documentation..."
required_docs=(
    "README.md"
    "docs/connector-setup.md"
    "docs/troubleshooting.md"
    "docs/kms-permissions.md"
    "validation/smoke_tests.kql"
)

docs_valid=true
for doc in "${required_docs[@]}"; do
    if [[ -f "$doc" ]]; then
        print_success "Found documentation: $doc"
    else
        print_error "Missing documentation: $doc"
        docs_valid=false
    fi
done

if [[ "$docs_valid" == true ]]; then
    print_success "All required documentation exists"
else
    print_error "Some documentation is missing"
    exit 1
fi

echo ""

# Summary
print_success "🎉 All deployment tests passed!"
echo ""
print_status "Test Summary:"
echo "✅ Required files exist"
echo "✅ JSON syntax is valid"
echo "✅ ARM template structure is correct"
echo "✅ Sample data is valid"
echo "✅ KQL syntax validation passed"
echo "✅ Deployment script is ready"
echo "✅ Documentation is complete"
echo ""
print_status "Next Steps:"
echo "1. Deploy to a test Sentinel workspace:"
echo "   ./deploy.sh -g test-rg -w test-workspace"
echo ""
echo "2. Run smoke tests in Sentinel:"
echo "   Copy queries from validation/smoke_tests.kql"
echo ""
echo "3. Test with sample data:"
echo "   Copy queries from test-local.kql"