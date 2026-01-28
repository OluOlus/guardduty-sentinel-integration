#!/bin/bash

# GuardDuty Sentinel Integration - Deployment Script
# This script deploys the KQL parsing functions to your Sentinel workspace

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
RESOURCE_GROUP=""
WORKSPACE_NAME=""
GUARDDUTY_TABLE="AWSGuardDuty"
RAW_COLUMN="EventData"
DEFAULT_LOOKBACK="7d"
TEMPLATE_FILE="deployment/azuredeploy.json"
PARAMETERS_FILE="deployment/azuredeploy.parameters.json"

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 -g <resource-group> -w <workspace-name> [options]"
    echo ""
    echo "Required parameters:"
    echo "  -g, --resource-group    Azure resource group name"
    echo "  -w, --workspace         Sentinel workspace name"
    echo ""
    echo "Optional parameters:"
    echo "  -t, --table            GuardDuty table name (default: AWSGuardDuty)"
    echo "  -c, --column           Raw data column name (default: EventData)"
    echo "  -l, --lookback         Default lookback period (default: 7d)"
    echo "  -f, --template-file    ARM template file (default: deployment/azuredeploy.json)"
    echo "  -p, --parameters-file  Parameters file (default: deployment/azuredeploy.parameters.json)"
    echo "  -h, --help             Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 -g my-rg -w my-sentinel-workspace"
    echo "  $0 -g my-rg -w my-workspace -t CustomGuardDutyTable -c RawData"
    echo ""
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -g|--resource-group)
            RESOURCE_GROUP="$2"
            shift 2
            ;;
        -w|--workspace)
            WORKSPACE_NAME="$2"
            shift 2
            ;;
        -t|--table)
            GUARDDUTY_TABLE="$2"
            shift 2
            ;;
        -c|--column)
            RAW_COLUMN="$2"
            shift 2
            ;;
        -l|--lookback)
            DEFAULT_LOOKBACK="$2"
            shift 2
            ;;
        -f|--template-file)
            TEMPLATE_FILE="$2"
            shift 2
            ;;
        -p|--parameters-file)
            PARAMETERS_FILE="$2"
            shift 2
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        *)
            print_error "Unknown parameter: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Validate required parameters
if [[ -z "$RESOURCE_GROUP" ]]; then
    print_error "Resource group is required"
    show_usage
    exit 1
fi

if [[ -z "$WORKSPACE_NAME" ]]; then
    print_error "Workspace name is required"
    show_usage
    exit 1
fi

# Check if required files exist
if [[ ! -f "$TEMPLATE_FILE" ]]; then
    print_error "Template file not found: $TEMPLATE_FILE"
    exit 1
fi

print_status "Starting GuardDuty Sentinel Integration deployment..."
echo ""
print_status "Configuration:"
echo "  Resource Group: $RESOURCE_GROUP"
echo "  Workspace Name: $WORKSPACE_NAME"
echo "  GuardDuty Table: $GUARDDUTY_TABLE"
echo "  Raw Data Column: $RAW_COLUMN"
echo "  Default Lookback: $DEFAULT_LOOKBACK"
echo "  Template File: $TEMPLATE_FILE"
echo ""

# Check if Azure CLI is installed and logged in
print_status "Checking Azure CLI..."
if ! command -v az &> /dev/null; then
    print_error "Azure CLI is not installed. Please install it first."
    print_error "Visit: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
    exit 1
fi

# Check if logged in to Azure
if ! az account show &> /dev/null; then
    print_error "Not logged in to Azure. Please run 'az login' first."
    exit 1
fi

print_success "Azure CLI is ready"

# Check if resource group exists
print_status "Checking resource group..."
if ! az group show --name "$RESOURCE_GROUP" &> /dev/null; then
    print_error "Resource group '$RESOURCE_GROUP' does not exist."
    print_error "Please create it first or use an existing resource group."
    exit 1
fi

print_success "Resource group exists"

# Check if workspace exists
print_status "Checking Log Analytics workspace..."
if ! az monitor log-analytics workspace show --resource-group "$RESOURCE_GROUP" --workspace-name "$WORKSPACE_NAME" &> /dev/null; then
    print_error "Log Analytics workspace '$WORKSPACE_NAME' does not exist in resource group '$RESOURCE_GROUP'."
    print_error "Please create the workspace first or check the names."
    exit 1
fi

print_success "Log Analytics workspace exists"

# Create temporary parameters file
TEMP_PARAMS=$(mktemp)
cat > "$TEMP_PARAMS" << EOF
{
    "\$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "workspaceName": {
            "value": "$WORKSPACE_NAME"
        },
        "guardDutyTableName": {
            "value": "$GUARDDUTY_TABLE"
        },
        "rawDataColumn": {
            "value": "$RAW_COLUMN"
        },
        "defaultLookback": {
            "value": "$DEFAULT_LOOKBACK"
        }
    }
}
EOF

# Deploy the template
print_status "Deploying KQL functions..."
DEPLOYMENT_NAME="guardduty-kql-$(date +%Y%m%d-%H%M%S)"

if az deployment group create \
    --resource-group "$RESOURCE_GROUP" \
    --name "$DEPLOYMENT_NAME" \
    --template-file "$TEMPLATE_FILE" \
    --parameters "@$TEMP_PARAMS" \
    --output table; then
    
    print_success "Deployment completed successfully!"
    
    # Clean up temp file
    rm -f "$TEMP_PARAMS"
    
    echo ""
    print_success "🎉 GuardDuty KQL functions have been deployed!"
    echo ""
    print_status "Next steps:"
    echo "1. Verify your AWS S3 connector is ingesting GuardDuty data"
    echo "2. Run the smoke tests to validate the deployment:"
    echo ""
    echo "   // Copy and run queries from validation/smoke_tests.kql"
    echo "   AWSGuardDuty_Main(1d) | take 10"
    echo ""
    echo "3. Try some sample queries:"
    echo ""
    echo "   // High severity findings"
    echo "   AWSGuardDuty_Main(1d) | where SeverityLevel == \"High\""
    echo ""
    echo "   // Network analysis"
    echo "   AWSGuardDuty_Network(7d) | summarize count() by RemoteCountry"
    echo ""
    print_status "For troubleshooting, see: docs/troubleshooting.md"
    print_status "For KMS permission issues, see: docs/kms-permissions.md"
    
else
    print_error "Deployment failed!"
    rm -f "$TEMP_PARAMS"
    exit 1
fi