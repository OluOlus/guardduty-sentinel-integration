#!/bin/bash

# Azure Function deployment script for GuardDuty to Sentinel integration
# This script deploys the Azure Function worker with proper configuration

set -e

# Configuration
RESOURCE_GROUP="${AZURE_RESOURCE_GROUP_NAME:-guardduty-sentinel-rg}"
FUNCTION_APP_NAME="${AZURE_FUNCTION_APP_NAME:-guardduty-sentinel-func}"
STORAGE_ACCOUNT="${AZURE_STORAGE_ACCOUNT:-guarddutysentinelsa}"
LOCATION="${AZURE_LOCATION:-eastus}"
RUNTIME="node"
RUNTIME_VERSION="18"

echo "🚀 Deploying GuardDuty Sentinel Azure Function"
echo "Resource Group: $RESOURCE_GROUP"
echo "Function App: $FUNCTION_APP_NAME"
echo "Location: $LOCATION"

# Check if Azure CLI is installed
if ! command -v az &> /dev/null; then
    echo "❌ Azure CLI is not installed. Please install it first."
    exit 1
fi

# Check if logged in to Azure
if ! az account show &> /dev/null; then
    echo "❌ Not logged in to Azure. Please run 'az login' first."
    exit 1
fi

# Create resource group if it doesn't exist
echo "📦 Creating resource group..."
az group create \
    --name "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --output table

# Create storage account if it doesn't exist
echo "💾 Creating storage account..."
az storage account create \
    --name "$STORAGE_ACCOUNT" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --sku Standard_LRS \
    --kind StorageV2 \
    --output table

# Create function app
echo "⚡ Creating function app..."
az functionapp create \
    --name "$FUNCTION_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --storage-account "$STORAGE_ACCOUNT" \
    --runtime "$RUNTIME" \
    --runtime-version "$RUNTIME_VERSION" \
    --functions-version 4 \
    --consumption-plan-location "$LOCATION" \
    --output table

# Configure application settings
echo "⚙️  Configuring application settings..."

# Required settings for the function
az functionapp config appsettings set \
    --name "$FUNCTION_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --settings \
        "AZURE_TENANT_ID=${AZURE_TENANT_ID}" \
        "AZURE_CLIENT_ID=${AZURE_CLIENT_ID}" \
        "AZURE_CLIENT_SECRET=${AZURE_CLIENT_SECRET}" \
        "AZURE_WORKSPACE_ID=${AZURE_WORKSPACE_ID}" \
        "AZURE_SUBSCRIPTION_ID=${AZURE_SUBSCRIPTION_ID}" \
        "AZURE_RESOURCE_GROUP_NAME=${AZURE_RESOURCE_GROUP_NAME}" \
        "AZURE_DCR_IMMUTABLE_ID=${AZURE_DCR_IMMUTABLE_ID}" \
        "AZURE_DCR_STREAM_NAME=${AZURE_DCR_STREAM_NAME}" \
        "AWS_REGION=${AWS_REGION}" \
        "AWS_S3_BUCKET_NAME=${AWS_S3_BUCKET_NAME}" \
        "AWS_S3_BUCKET_PREFIX=${AWS_S3_BUCKET_PREFIX:-}" \
        "AWS_KMS_KEY_ARN=${AWS_KMS_KEY_ARN:-}" \
        "BATCH_SIZE=${BATCH_SIZE:-100}" \
        "MAX_RETRIES=${MAX_RETRIES:-3}" \
        "RETRY_BACKOFF_MS=${RETRY_BACKOFF_MS:-1000}" \
        "ENABLE_NORMALIZATION=${ENABLE_NORMALIZATION:-false}" \
        "ENABLE_DEDUPLICATION=${ENABLE_DEDUPLICATION:-true}" \
        "DEDUPLICATION_STRATEGY=${DEDUPLICATION_STRATEGY:-findingId}" \
        "LOG_LEVEL=${LOG_LEVEL:-info}" \
        "ENABLE_METRICS=${ENABLE_METRICS:-true}" \
    --output table

# Build the function
echo "🔨 Building function..."
npm run build

# Deploy the function
echo "📤 Deploying function code..."
func azure functionapp publish "$FUNCTION_APP_NAME" --typescript

# Get function URLs
echo "🔗 Getting function URLs..."
HTTP_URL=$(az functionapp function show \
    --name "$FUNCTION_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --function-name "guardduty-http" \
    --query "invokeUrlTemplate" \
    --output tsv)

echo ""
echo "✅ Deployment completed successfully!"
echo ""
echo "📋 Function Details:"
echo "   Resource Group: $RESOURCE_GROUP"
echo "   Function App: $FUNCTION_APP_NAME"
echo "   HTTP Trigger URL: $HTTP_URL"
echo ""
echo "🔧 Next Steps:"
echo "   1. Test the HTTP endpoint: curl -X GET '$HTTP_URL'"
echo "   2. Monitor logs: az functionapp log tail --name '$FUNCTION_APP_NAME' --resource-group '$RESOURCE_GROUP'"
echo "   3. View metrics in Azure Portal"
echo ""
echo "⏰ Timer Trigger Schedule: Every 15 minutes (0 */15 * * * *)"
echo ""

# Optional: Enable Application Insights
read -p "🔍 Enable Application Insights for monitoring? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "📊 Enabling Application Insights..."
    
    APPINSIGHTS_NAME="${FUNCTION_APP_NAME}-insights"
    
    # Create Application Insights
    az monitor app-insights component create \
        --app "$APPINSIGHTS_NAME" \
        --location "$LOCATION" \
        --resource-group "$RESOURCE_GROUP" \
        --output table
    
    # Get instrumentation key
    INSTRUMENTATION_KEY=$(az monitor app-insights component show \
        --app "$APPINSIGHTS_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --query "instrumentationKey" \
        --output tsv)
    
    # Configure function app to use Application Insights
    az functionapp config appsettings set \
        --name "$FUNCTION_APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --settings "APPINSIGHTS_INSTRUMENTATIONKEY=$INSTRUMENTATION_KEY" \
        --output table
    
    echo "✅ Application Insights enabled!"
fi

echo ""
echo "🎉 Azure Function deployment complete!"