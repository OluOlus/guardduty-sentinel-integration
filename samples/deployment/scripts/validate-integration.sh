#!/bin/bash

# GuardDuty to Sentinel Integration - Validation Script
# This script validates the end-to-end integration is working correctly

set -e  # Exit on any error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$SCRIPT_DIR/../config"
AWS_CONFIG_FILE="$CONFIG_DIR/generated-aws-config.json"
AZURE_CONFIG_FILE="$CONFIG_DIR/generated-azure-config.json"

# Test results tracking
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
WARNING_TESTS=0

# Function to run a test
run_test() {
    local test_name="$1"
    local test_command="$2"
    local is_critical="${3:-true}"
    
    ((TOTAL_TESTS++))
    log_info "Running test: $test_name"
    
    if eval "$test_command"; then
        log_success "✅ $test_name"
        ((PASSED_TESTS++))
        return 0
    else
        if [ "$is_critical" = "true" ]; then
            log_error "❌ $test_name"
            ((FAILED_TESTS++))
        else
            log_warning "⚠️  $test_name"
            ((WARNING_TESTS++))
        fi
        return 1
    fi
}

# Function to check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check required tools
    for tool in aws az jq curl; do
        if ! command -v $tool &> /dev/null; then
            log_error "$tool is not installed"
            exit 1
        fi
    done
    
    # Check configuration files
    if [ ! -f "$AWS_CONFIG_FILE" ]; then
        log_error "AWS configuration file not found: $AWS_CONFIG_FILE"
        log_info "Run setup-aws-resources.sh first"
        exit 1
    fi
    
    if [ ! -f "$AZURE_CONFIG_FILE" ]; then
        log_error "Azure configuration file not found: $AZURE_CONFIG_FILE"
        log_info "Run Setup-AzureResources.ps1 first"
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

# Function to load configuration
load_configuration() {
    log_info "Loading configuration..."
    
    # Load AWS configuration
    AWS_REGION=$(jq -r '.aws.region' "$AWS_CONFIG_FILE")
    S3_BUCKET=$(jq -r '.aws.s3BucketName' "$AWS_CONFIG_FILE")
    DETECTOR_ID=$(jq -r '.guardduty.detectorId' "$AWS_CONFIG_FILE")
    ACCOUNT_ID=$(jq -r '.metadata.accountId' "$AWS_CONFIG_FILE")
    
    # Load Azure configuration
    WORKSPACE_ID=$(jq -r '.azure.workspaceId' "$AZURE_CONFIG_FILE")
    RESOURCE_GROUP=$(jq -r '.azure.resourceGroupName' "$AZURE_CONFIG_FILE")
    WORKSPACE_NAME=$(jq -r '.metadata.workspaceName // "guardduty-sentinel-workspace"' "$AZURE_CONFIG_FILE")
    DCR_IMMUTABLE_ID=$(jq -r '.dcr.immutableId' "$AZURE_CONFIG_FILE")
    
    log_info "Configuration loaded:"
    log_info "  AWS Region: $AWS_REGION"
    log_info "  S3 Bucket: $S3_BUCKET"
    log_info "  Azure Workspace: $WORKSPACE_ID"
    log_info "  DCR ID: $DCR_IMMUTABLE_ID"
}

# Test functions
test_aws_authentication() {
    aws sts get-caller-identity > /dev/null 2>&1
}

test_azure_authentication() {
    az account show > /dev/null 2>&1
}

test_s3_bucket_access() {
    aws s3 ls "s3://$S3_BUCKET/" > /dev/null 2>&1
}

test_guardduty_detector() {
    aws guardduty get-detector --detector-id "$DETECTOR_ID" --region "$AWS_REGION" > /dev/null 2>&1
}

test_azure_workspace_access() {
    az monitor log-analytics workspace show \
        --resource-group "$RESOURCE_GROUP" \
        --workspace-name "$WORKSPACE_NAME" > /dev/null 2>&1
}

test_dcr_access() {
    az monitor data-collection rule show \
        --resource-group "$RESOURCE_GROUP" \
        --name "guardduty-dcr" > /dev/null 2>&1
}

test_guardduty_exports() {
    local export_path="AWSLogs/$ACCOUNT_ID/GuardDuty/$AWS_REGION/"
    local export_count=$(aws s3 ls "s3://$S3_BUCKET/$export_path" --recursive | grep "\.jsonl\.gz$" | wc -l)
    [ "$export_count" -gt 0 ]
}

test_recent_guardduty_exports() {
    local export_path="AWSLogs/$ACCOUNT_ID/GuardDuty/$AWS_REGION/"
    local today=$(date +%Y/%m/%d)
    local yesterday=$(date -d '1 day ago' +%Y/%m/%d)
    
    local recent_count=$(aws s3 ls "s3://$S3_BUCKET/$export_path" --recursive | grep -E "($today|$yesterday)" | wc -l)
    [ "$recent_count" -gt 0 ]
}

test_s3_file_download() {
    local export_path="AWSLogs/$ACCOUNT_ID/GuardDuty/$AWS_REGION/"
    local latest_file=$(aws s3 ls "s3://$S3_BUCKET/$export_path" --recursive | grep "\.jsonl\.gz$" | tail -1 | awk '{print $4}')
    
    if [ -n "$latest_file" ]; then
        aws s3 cp "s3://$S3_BUCKET/$latest_file" /tmp/test-finding.jsonl.gz > /dev/null 2>&1
        local result=$?
        rm -f /tmp/test-finding.jsonl.gz
        return $result
    else
        return 1
    fi
}

test_s3_file_decompression() {
    local export_path="AWSLogs/$ACCOUNT_ID/GuardDuty/$AWS_REGION/"
    local latest_file=$(aws s3 ls "s3://$S3_BUCKET/$export_path" --recursive | grep "\.jsonl\.gz$" | tail -1 | awk '{print $4}')
    
    if [ -n "$latest_file" ]; then
        aws s3 cp "s3://$S3_BUCKET/$latest_file" /tmp/test-finding.jsonl.gz > /dev/null 2>&1
        local decompress_result=$(gunzip -t /tmp/test-finding.jsonl.gz 2>&1)
        local result=$?
        rm -f /tmp/test-finding.jsonl.gz
        return $result
    else
        return 1
    fi
}

test_worker_health_endpoint() {
    # Try common worker health endpoints
    for port in 8080 3000 8000; do
        if curl -f "http://localhost:$port/health" > /dev/null 2>&1; then
            return 0
        fi
    done
    return 1
}

# Function to generate test finding
generate_test_finding() {
    log_info "Generating test GuardDuty finding..."
    
    aws guardduty create-sample-findings \
        --detector-id "$DETECTOR_ID" \
        --finding-types "Backdoor:EC2/XORDDOS" \
        --region "$AWS_REGION" > /dev/null 2>&1
    
    if [ $? -eq 0 ]; then
        log_success "Test finding generated successfully"
        log_info "Finding will appear in S3 within 5-10 minutes"
        return 0
    else
        log_error "Failed to generate test finding"
        return 1
    fi
}

# Function to create Azure test queries
create_azure_test_queries() {
    log_info "Creating Azure test queries..."
    
    # Create test queries directory
    mkdir -p "$CONFIG_DIR/test-queries"
    
    # Query to check for recent data
    cat > "$CONFIG_DIR/test-queries/check-recent-data.kql" << 'EOF'
RawGuardDuty_CL
| where TimeGenerated > ago(1h)
| summarize Count = count() by bin(TimeGenerated, 5m)
| order by TimeGenerated desc
| limit 10
EOF
    
    # Query to test normalization
    cat > "$CONFIG_DIR/test-queries/test-normalization.kql" << 'EOF'
GuardDutyNormalized()
| where TimeGenerated > ago(1h)
| project TimeGenerated, FindingId, Type, Severity, AccountId, Region
| limit 5
EOF
    
    # Query to check for test finding
    cat > "$CONFIG_DIR/test-queries/check-test-finding.kql" << 'EOF'
RawGuardDuty_CL
| where TimeGenerated > ago(15m)
| where Type == "Backdoor:EC2/XORDDOS"
| project TimeGenerated, FindingId, Type, Severity, AccountId
| order by TimeGenerated desc
| limit 1
EOF
    
    log_success "Test queries created in $CONFIG_DIR/test-queries/"
}

# Function to display manual verification steps
display_manual_steps() {
    log_info "Manual verification steps:"
    echo ""
    echo "1. Check Azure Log Analytics for data:"
    echo "   - Open Azure Portal"
    echo "   - Navigate to Log Analytics workspace: $WORKSPACE_NAME"
    echo "   - Go to Logs section"
    echo "   - Run queries from: $CONFIG_DIR/test-queries/"
    echo ""
    echo "2. Verify worker is processing data:"
    echo "   - Check worker logs for processing activity"
    echo "   - Monitor health endpoint if available"
    echo "   - Check for error messages in logs"
    echo ""
    echo "3. Test end-to-end flow:"
    echo "   - Generate test finding (already done)"
    echo "   - Wait 10-15 minutes"
    echo "   - Check S3 for exported finding"
    echo "   - Check Azure for ingested data"
    echo ""
}

# Function to run performance tests
run_performance_tests() {
    log_info "Running performance tests..."
    
    # Test S3 list performance
    local start_time=$(date +%s)
    aws s3 ls "s3://$S3_BUCKET/AWSLogs/$ACCOUNT_ID/GuardDuty/$AWS_REGION/" --recursive > /dev/null 2>&1
    local end_time=$(date +%s)
    local s3_list_time=$((end_time - start_time))
    
    if [ $s3_list_time -lt 10 ]; then
        log_success "S3 list performance: ${s3_list_time}s (Good)"
    elif [ $s3_list_time -lt 30 ]; then
        log_warning "S3 list performance: ${s3_list_time}s (Acceptable)"
    else
        log_warning "S3 list performance: ${s3_list_time}s (Slow)"
    fi
    
    # Test Azure CLI performance
    start_time=$(date +%s)
    az monitor log-analytics workspace show \
        --resource-group "$RESOURCE_GROUP" \
        --workspace-name "$WORKSPACE_NAME" > /dev/null 2>&1
    end_time=$(date +%s)
    local azure_query_time=$((end_time - start_time))
    
    if [ $azure_query_time -lt 5 ]; then
        log_success "Azure query performance: ${azure_query_time}s (Good)"
    elif [ $azure_query_time -lt 15 ]; then
        log_warning "Azure query performance: ${azure_query_time}s (Acceptable)"
    else
        log_warning "Azure query performance: ${azure_query_time}s (Slow)"
    fi
}

# Function to display test summary
display_test_summary() {
    echo ""
    log_info "Test Summary:"
    echo "=============="
    echo "Total Tests: $TOTAL_TESTS"
    echo "Passed: $PASSED_TESTS"
    echo "Failed: $FAILED_TESTS"
    echo "Warnings: $WARNING_TESTS"
    echo ""
    
    local success_rate=$((PASSED_TESTS * 100 / TOTAL_TESTS))
    
    if [ $FAILED_TESTS -eq 0 ]; then
        log_success "All critical tests passed! Success rate: ${success_rate}%"
        if [ $WARNING_TESTS -gt 0 ]; then
            log_warning "Some non-critical tests had warnings. Review above for details."
        fi
        echo ""
        log_info "Integration appears to be working correctly!"
        return 0
    else
        log_error "Some critical tests failed. Success rate: ${success_rate}%"
        echo ""
        log_error "Integration has issues that need to be addressed."
        return 1
    fi
}

# Main execution
main() {
    log_info "Starting GuardDuty-Sentinel integration validation..."
    echo ""
    
    check_prerequisites
    load_configuration
    
    echo ""
    log_info "Running connectivity tests..."
    run_test "AWS Authentication" "test_aws_authentication"
    run_test "Azure Authentication" "test_azure_authentication"
    run_test "S3 Bucket Access" "test_s3_bucket_access"
    run_test "GuardDuty Detector Access" "test_guardduty_detector"
    run_test "Azure Workspace Access" "test_azure_workspace_access"
    run_test "DCR Access" "test_dcr_access"
    
    echo ""
    log_info "Running data flow tests..."
    run_test "GuardDuty Exports Exist" "test_guardduty_exports" "false"
    run_test "Recent GuardDuty Exports" "test_recent_guardduty_exports" "false"
    run_test "S3 File Download" "test_s3_file_download" "false"
    run_test "S3 File Decompression" "test_s3_file_decompression" "false"
    
    echo ""
    log_info "Running worker tests..."
    run_test "Worker Health Endpoint" "test_worker_health_endpoint" "false"
    
    echo ""
    log_info "Generating test data..."
    generate_test_finding
    
    echo ""
    create_azure_test_queries
    run_performance_tests
    
    echo ""
    display_manual_steps
    
    echo ""
    display_test_summary
}

# Run main function
main "$@"