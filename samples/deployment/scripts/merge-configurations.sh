#!/bin/bash

# GuardDuty to Sentinel Integration - Configuration Merger Script
# This script merges AWS and Azure configurations into a complete worker configuration

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
OUTPUT_CONFIG_FILE="$CONFIG_DIR/complete-worker-config.json"
OUTPUT_ENV_FILE="$CONFIG_DIR/complete-worker-config.env"

# Default configuration values
DEFAULT_BATCH_SIZE=100
DEFAULT_MAX_RETRIES=3
DEFAULT_RETRY_BACKOFF_MS=1000
DEFAULT_ENABLE_NORMALIZATION=true
DEFAULT_DEDUPLICATION_ENABLED=true
DEFAULT_DEDUPLICATION_STRATEGY="findingId"
DEFAULT_DEDUPLICATION_CACHE_SIZE=10000
DEFAULT_MONITORING_ENABLED=true
DEFAULT_HEALTH_CHECK_PORT=8080

# Function to check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check jq
    if ! command -v jq &> /dev/null; then
        log_error "jq is not installed. Please install it for JSON processing."
        exit 1
    fi
    
    # Check input files
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

# Function to get user preferences
get_user_preferences() {
    log_info "Gathering configuration preferences..."
    
    echo "Configure processing settings (press Enter for defaults):"
    
    read -p "Batch size [$DEFAULT_BATCH_SIZE]: " BATCH_SIZE
    BATCH_SIZE=${BATCH_SIZE:-$DEFAULT_BATCH_SIZE}
    
    read -p "Max retries [$DEFAULT_MAX_RETRIES]: " MAX_RETRIES
    MAX_RETRIES=${MAX_RETRIES:-$DEFAULT_MAX_RETRIES}
    
    read -p "Retry backoff (ms) [$DEFAULT_RETRY_BACKOFF_MS]: " RETRY_BACKOFF_MS
    RETRY_BACKOFF_MS=${RETRY_BACKOFF_MS:-$DEFAULT_RETRY_BACKOFF_MS}
    
    read -p "Enable normalization? (Y/n) [$DEFAULT_ENABLE_NORMALIZATION]: " ENABLE_NORMALIZATION_INPUT
    ENABLE_NORMALIZATION_INPUT=${ENABLE_NORMALIZATION_INPUT:-Y}
    if [[ $ENABLE_NORMALIZATION_INPUT =~ ^[Yy]$ ]]; then
        ENABLE_NORMALIZATION=true
    else
        ENABLE_NORMALIZATION=false
    fi
    
    read -p "Dead letter queue name (optional): " DEAD_LETTER_QUEUE
    
    echo ""
    echo "Configure deduplication settings:"
    
    read -p "Enable deduplication? (Y/n) [$DEFAULT_DEDUPLICATION_ENABLED]: " DEDUPLICATION_ENABLED_INPUT
    DEDUPLICATION_ENABLED_INPUT=${DEDUPLICATION_ENABLED_INPUT:-Y}
    if [[ $DEDUPLICATION_ENABLED_INPUT =~ ^[Yy]$ ]]; then
        DEDUPLICATION_ENABLED=true
        
        echo "Deduplication strategies:"
        echo "  1. findingId - Use GuardDuty finding ID (recommended)"
        echo "  2. contentHash - Use content hash"
        echo "  3. timeWindow - Use time-based windows"
        read -p "Choose strategy (1-3) [1]: " DEDUPLICATION_STRATEGY_CHOICE
        DEDUPLICATION_STRATEGY_CHOICE=${DEDUPLICATION_STRATEGY_CHOICE:-1}
        
        case $DEDUPLICATION_STRATEGY_CHOICE in
            1) DEDUPLICATION_STRATEGY="findingId" ;;
            2) DEDUPLICATION_STRATEGY="contentHash" ;;
            3) DEDUPLICATION_STRATEGY="timeWindow" ;;
            *) DEDUPLICATION_STRATEGY="findingId" ;;
        esac
        
        if [ "$DEDUPLICATION_STRATEGY" = "timeWindow" ]; then
            read -p "Time window (minutes) [60]: " DEDUPLICATION_TIME_WINDOW
            DEDUPLICATION_TIME_WINDOW=${DEDUPLICATION_TIME_WINDOW:-60}
        fi
        
        read -p "Cache size [$DEFAULT_DEDUPLICATION_CACHE_SIZE]: " DEDUPLICATION_CACHE_SIZE
        DEDUPLICATION_CACHE_SIZE=${DEDUPLICATION_CACHE_SIZE:-$DEFAULT_DEDUPLICATION_CACHE_SIZE}
    else
        DEDUPLICATION_ENABLED=false
    fi
    
    echo ""
    echo "Configure monitoring settings:"
    
    read -p "Enable metrics? (Y/n) [$DEFAULT_MONITORING_ENABLED]: " MONITORING_ENABLED_INPUT
    MONITORING_ENABLED_INPUT=${MONITORING_ENABLED_INPUT:-Y}
    if [[ $MONITORING_ENABLED_INPUT =~ ^[Yy]$ ]]; then
        MONITORING_ENABLED=true
    else
        MONITORING_ENABLED=false
    fi
    
    read -p "Enable detailed logging? (y/N): " DETAILED_LOGGING_INPUT
    if [[ $DETAILED_LOGGING_INPUT =~ ^[Yy]$ ]]; then
        DETAILED_LOGGING=true
    else
        DETAILED_LOGGING=false
    fi
    
    read -p "Health check port [$DEFAULT_HEALTH_CHECK_PORT]: " HEALTH_CHECK_PORT
    HEALTH_CHECK_PORT=${HEALTH_CHECK_PORT:-$DEFAULT_HEALTH_CHECK_PORT}
    
    echo "Metrics backend options:"
    echo "  1. console - Log to console (default)"
    echo "  2. azure-monitor - Send to Azure Monitor"
    echo "  3. prometheus - Prometheus metrics"
    read -p "Choose metrics backend (1-3) [1]: " METRICS_BACKEND_CHOICE
    METRICS_BACKEND_CHOICE=${METRICS_BACKEND_CHOICE:-1}
    
    case $METRICS_BACKEND_CHOICE in
        1) METRICS_BACKEND_TYPE="console" ;;
        2) METRICS_BACKEND_TYPE="azure-monitor" ;;
        3) METRICS_BACKEND_TYPE="prometheus" ;;
        *) METRICS_BACKEND_TYPE="console" ;;
    esac
}

# Function to load existing configurations
load_existing_configurations() {
    log_info "Loading existing configurations..."
    
    # Load AWS configuration
    AWS_REGION=$(jq -r '.aws.region' "$AWS_CONFIG_FILE")
    S3_BUCKET_NAME=$(jq -r '.aws.s3BucketName' "$AWS_CONFIG_FILE")
    S3_BUCKET_PREFIX=$(jq -r '.aws.s3BucketPrefix' "$AWS_CONFIG_FILE")
    KMS_KEY_ARN=$(jq -r '.aws.kmsKeyArn // ""' "$AWS_CONFIG_FILE")
    WORKER_ROLE_ARN=$(jq -r '.aws.workerRoleArn // ""' "$AWS_CONFIG_FILE")
    
    # Load Azure configuration
    AZURE_ENDPOINT=$(jq -r '.azureEndpoint' "$AZURE_CONFIG_FILE")
    DCR_IMMUTABLE_ID=$(jq -r '.dcr.immutableId' "$AZURE_CONFIG_FILE")
    DCR_STREAM_NAME=$(jq -r '.dcr.streamName' "$AZURE_CONFIG_FILE")
    AZURE_TENANT_ID=$(jq -r '.azure.tenantId' "$AZURE_CONFIG_FILE")
    AZURE_CLIENT_ID=$(jq -r '.azure.clientId' "$AZURE_CONFIG_FILE")
    AZURE_CLIENT_SECRET=$(jq -r '.azure.clientSecret' "$AZURE_CONFIG_FILE")
    AZURE_WORKSPACE_ID=$(jq -r '.azure.workspaceId' "$AZURE_CONFIG_FILE")
    AZURE_SUBSCRIPTION_ID=$(jq -r '.azure.subscriptionId' "$AZURE_CONFIG_FILE")
    AZURE_RESOURCE_GROUP_NAME=$(jq -r '.azure.resourceGroupName' "$AZURE_CONFIG_FILE")
    
    log_success "Configurations loaded successfully"
}

# Function to create complete JSON configuration
create_json_configuration() {
    log_info "Creating complete JSON configuration..."
    
    # Build deduplication configuration
    local deduplication_config="{\"enabled\": $DEDUPLICATION_ENABLED"
    if [ "$DEDUPLICATION_ENABLED" = "true" ]; then
        deduplication_config="$deduplication_config, \"strategy\": \"$DEDUPLICATION_STRATEGY\""
        deduplication_config="$deduplication_config, \"cacheSize\": $DEDUPLICATION_CACHE_SIZE"
        if [ "$DEDUPLICATION_STRATEGY" = "timeWindow" ] && [ -n "$DEDUPLICATION_TIME_WINDOW" ]; then
            deduplication_config="$deduplication_config, \"timeWindowMinutes\": $DEDUPLICATION_TIME_WINDOW"
        fi
    fi
    deduplication_config="$deduplication_config}"
    
    # Build metrics backend configuration
    local metrics_backend_config="{\"type\": \"$METRICS_BACKEND_TYPE\", \"config\": {}}"
    if [ "$METRICS_BACKEND_TYPE" = "azure-monitor" ]; then
        metrics_backend_config="{\"type\": \"$METRICS_BACKEND_TYPE\", \"config\": {\"workspaceId\": \"$AZURE_WORKSPACE_ID\"}}"
    fi
    
    # Create complete configuration
    cat > "$OUTPUT_CONFIG_FILE" << EOF
{
  "batchSize": $BATCH_SIZE,
  "maxRetries": $MAX_RETRIES,
  "retryBackoffMs": $RETRY_BACKOFF_MS,
  "enableNormalization": $ENABLE_NORMALIZATION,
  $([ -n "$DEAD_LETTER_QUEUE" ] && echo "\"deadLetterQueue\": \"$DEAD_LETTER_QUEUE\",")
  "azureEndpoint": "$AZURE_ENDPOINT",
  "dcr": {
    "immutableId": "$DCR_IMMUTABLE_ID",
    "streamName": "$DCR_STREAM_NAME"
  },
  "aws": {
    "region": "$AWS_REGION",
    "s3BucketName": "$S3_BUCKET_NAME",
    "s3BucketPrefix": "$S3_BUCKET_PREFIX"$([ -n "$KMS_KEY_ARN" ] && echo ",")
    $([ -n "$KMS_KEY_ARN" ] && echo "\"kmsKeyArn\": \"$KMS_KEY_ARN\"")
  },
  "azure": {
    "tenantId": "$AZURE_TENANT_ID",
    "clientId": "$AZURE_CLIENT_ID",
    "clientSecret": "$AZURE_CLIENT_SECRET",
    "workspaceId": "$AZURE_WORKSPACE_ID",
    "subscriptionId": "$AZURE_SUBSCRIPTION_ID",
    "resourceGroupName": "$AZURE_RESOURCE_GROUP_NAME"
  },
  "deduplication": $deduplication_config,
  "monitoring": {
    "enableMetrics": $MONITORING_ENABLED,
    "enableDetailedLogging": $DETAILED_LOGGING,
    "healthCheckPort": $HEALTH_CHECK_PORT,
    "metricsBackend": $metrics_backend_config
  },
  "metadata": {
    "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "createdBy": "merge-configurations.sh",
    "version": "1.0.0"
  }
}
EOF
    
    # Format JSON properly
    jq '.' "$OUTPUT_CONFIG_FILE" > "$OUTPUT_CONFIG_FILE.tmp" && mv "$OUTPUT_CONFIG_FILE.tmp" "$OUTPUT_CONFIG_FILE"
    
    log_success "JSON configuration created: $OUTPUT_CONFIG_FILE"
}

# Function to create environment variables configuration
create_env_configuration() {
    log_info "Creating environment variables configuration..."
    
    cat > "$OUTPUT_ENV_FILE" << EOF
# GuardDuty to Sentinel Integration - Complete Configuration
# Generated on $(date -u +%Y-%m-%dT%H:%M:%SZ)

# Core Processing Settings
BATCH_SIZE=$BATCH_SIZE
MAX_RETRIES=$MAX_RETRIES
RETRY_BACKOFF_MS=$RETRY_BACKOFF_MS
ENABLE_NORMALIZATION=$ENABLE_NORMALIZATION
$([ -n "$DEAD_LETTER_QUEUE" ] && echo "DEAD_LETTER_QUEUE=$DEAD_LETTER_QUEUE")

# Azure Configuration
AZURE_ENDPOINT=$AZURE_ENDPOINT
DCR_IMMUTABLE_ID=$DCR_IMMUTABLE_ID
DCR_STREAM_NAME=$DCR_STREAM_NAME

# AWS Configuration
AWS_REGION=$AWS_REGION
AWS_S3_BUCKET_NAME=$S3_BUCKET_NAME
AWS_S3_BUCKET_PREFIX=$S3_BUCKET_PREFIX
$([ -n "$KMS_KEY_ARN" ] && echo "AWS_KMS_KEY_ARN=$KMS_KEY_ARN")

# Azure Authentication
AZURE_TENANT_ID=$AZURE_TENANT_ID
AZURE_CLIENT_ID=$AZURE_CLIENT_ID
AZURE_CLIENT_SECRET=$AZURE_CLIENT_SECRET
AZURE_WORKSPACE_ID=$AZURE_WORKSPACE_ID
AZURE_SUBSCRIPTION_ID=$AZURE_SUBSCRIPTION_ID
AZURE_RESOURCE_GROUP_NAME=$AZURE_RESOURCE_GROUP_NAME

# Deduplication Settings
DEDUPLICATION_ENABLED=$DEDUPLICATION_ENABLED
$([ "$DEDUPLICATION_ENABLED" = "true" ] && echo "DEDUPLICATION_STRATEGY=$DEDUPLICATION_STRATEGY")
$([ "$DEDUPLICATION_ENABLED" = "true" ] && echo "DEDUPLICATION_CACHE_SIZE=$DEDUPLICATION_CACHE_SIZE")
$([ "$DEDUPLICATION_STRATEGY" = "timeWindow" ] && [ -n "$DEDUPLICATION_TIME_WINDOW" ] && echo "DEDUPLICATION_TIME_WINDOW_MINUTES=$DEDUPLICATION_TIME_WINDOW")

# Monitoring Settings
MONITORING_ENABLE_METRICS=$MONITORING_ENABLED
MONITORING_ENABLE_DETAILED_LOGGING=$DETAILED_LOGGING
MONITORING_HEALTH_CHECK_PORT=$HEALTH_CHECK_PORT
MONITORING_METRICS_BACKEND_TYPE=$METRICS_BACKEND_TYPE
EOF
    
    log_success "Environment configuration created: $OUTPUT_ENV_FILE"
}

# Function to create deployment-specific configurations
create_deployment_configurations() {
    log_info "Creating deployment-specific configurations..."
    
    # Azure Function configuration
    cat > "$CONFIG_DIR/azure-function-settings.json" << EOF
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "DefaultEndpointsProtocol=https;AccountName=YOUR_STORAGE_ACCOUNT;AccountKey=YOUR_KEY;EndpointSuffix=core.windows.net",
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "FUNCTIONS_EXTENSION_VERSION": "~4",
    "BATCH_SIZE": "$BATCH_SIZE",
    "MAX_RETRIES": "$MAX_RETRIES",
    "RETRY_BACKOFF_MS": "$RETRY_BACKOFF_MS",
    "ENABLE_NORMALIZATION": "$ENABLE_NORMALIZATION",
    "AZURE_ENDPOINT": "$AZURE_ENDPOINT",
    "DCR_IMMUTABLE_ID": "$DCR_IMMUTABLE_ID",
    "DCR_STREAM_NAME": "$DCR_STREAM_NAME",
    "AWS_REGION": "$AWS_REGION",
    "AWS_S3_BUCKET_NAME": "$S3_BUCKET_NAME",
    "AWS_S3_BUCKET_PREFIX": "$S3_BUCKET_PREFIX",
    $([ -n "$KMS_KEY_ARN" ] && echo "\"AWS_KMS_KEY_ARN\": \"$KMS_KEY_ARN\",")
    "AZURE_TENANT_ID": "$AZURE_TENANT_ID",
    "AZURE_CLIENT_ID": "$AZURE_CLIENT_ID",
    "AZURE_CLIENT_SECRET": "$AZURE_CLIENT_SECRET",
    "AZURE_WORKSPACE_ID": "$AZURE_WORKSPACE_ID",
    "AZURE_SUBSCRIPTION_ID": "$AZURE_SUBSCRIPTION_ID",
    "AZURE_RESOURCE_GROUP_NAME": "$AZURE_RESOURCE_GROUP_NAME",
    "DEDUPLICATION_ENABLED": "$DEDUPLICATION_ENABLED",
    $([ "$DEDUPLICATION_ENABLED" = "true" ] && echo "\"DEDUPLICATION_STRATEGY\": \"$DEDUPLICATION_STRATEGY\",")
    "MONITORING_ENABLE_METRICS": "$MONITORING_ENABLED"
  }
}
EOF
    
    # Lambda environment configuration
    cat > "$CONFIG_DIR/lambda-environment.json" << EOF
{
  "Variables": {
    "BATCH_SIZE": "$BATCH_SIZE",
    "MAX_RETRIES": "$MAX_RETRIES",
    "RETRY_BACKOFF_MS": "$RETRY_BACKOFF_MS",
    "ENABLE_NORMALIZATION": "$ENABLE_NORMALIZATION",
    $([ -n "$DEAD_LETTER_QUEUE" ] && echo "\"DEAD_LETTER_QUEUE\": \"$DEAD_LETTER_QUEUE\",")
    "AZURE_ENDPOINT": "$AZURE_ENDPOINT",
    "DCR_IMMUTABLE_ID": "$DCR_IMMUTABLE_ID",
    "DCR_STREAM_NAME": "$DCR_STREAM_NAME",
    "AWS_REGION": "$AWS_REGION",
    "AWS_S3_BUCKET_NAME": "$S3_BUCKET_NAME",
    "AWS_S3_BUCKET_PREFIX": "$S3_BUCKET_PREFIX",
    $([ -n "$KMS_KEY_ARN" ] && echo "\"AWS_KMS_KEY_ARN\": \"$KMS_KEY_ARN\",")
    "AZURE_TENANT_ID": "$AZURE_TENANT_ID",
    "AZURE_CLIENT_ID": "$AZURE_CLIENT_ID",
    "AZURE_CLIENT_SECRET": "$AZURE_CLIENT_SECRET",
    "AZURE_WORKSPACE_ID": "$AZURE_WORKSPACE_ID",
    "AZURE_SUBSCRIPTION_ID": "$AZURE_SUBSCRIPTION_ID",
    "AZURE_RESOURCE_GROUP_NAME": "$AZURE_RESOURCE_GROUP_NAME",
    "DEDUPLICATION_ENABLED": "$DEDUPLICATION_ENABLED"$([ "$DEDUPLICATION_ENABLED" = "true" ] && echo ",")
    $([ "$DEDUPLICATION_ENABLED" = "true" ] && echo "\"DEDUPLICATION_STRATEGY\": \"$DEDUPLICATION_STRATEGY\"")
  }
}
EOF
    
    # Docker Compose configuration
    cat > "$CONFIG_DIR/docker-compose.yml" << EOF
version: '3.8'

services:
  guardduty-worker:
    build: ../../..
    environment:
      - NODE_ENV=production
    env_file:
      - complete-worker-config.env
    ports:
      - "$HEALTH_CHECK_PORT:$HEALTH_CHECK_PORT"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:$HEALTH_CHECK_PORT/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
EOF
    
    log_success "Deployment configurations created:"
    log_info "  - azure-function-settings.json"
    log_info "  - lambda-environment.json"
    log_info "  - docker-compose.yml"
}

# Function to validate configuration
validate_configuration() {
    log_info "Validating configuration..."
    
    # Check required fields
    local required_fields=(
        "batchSize" "maxRetries" "retryBackoffMs" "enableNormalization"
        "azureEndpoint" "dcr.immutableId" "dcr.streamName"
        "aws.region" "aws.s3BucketName" "aws.s3BucketPrefix"
        "azure.tenantId" "azure.clientId" "azure.clientSecret"
        "azure.workspaceId" "azure.subscriptionId" "azure.resourceGroupName"
    )
    
    for field in "${required_fields[@]}"; do
        local value=$(jq -r ".$field" "$OUTPUT_CONFIG_FILE")
        if [ "$value" = "null" ] || [ -z "$value" ]; then
            log_error "Required field missing: $field"
            return 1
        fi
    done
    
    # Validate numeric ranges
    local batch_size=$(jq -r '.batchSize' "$OUTPUT_CONFIG_FILE")
    if [ "$batch_size" -lt 1 ] || [ "$batch_size" -gt 1000 ]; then
        log_error "Batch size must be between 1 and 1000"
        return 1
    fi
    
    local max_retries=$(jq -r '.maxRetries' "$OUTPUT_CONFIG_FILE")
    if [ "$max_retries" -lt 0 ] || [ "$max_retries" -gt 10 ]; then
        log_error "Max retries must be between 0 and 10"
        return 1
    fi
    
    # Validate URLs
    local azure_endpoint=$(jq -r '.azureEndpoint' "$OUTPUT_CONFIG_FILE")
    if [[ ! $azure_endpoint =~ ^https:// ]]; then
        log_error "Azure endpoint must use HTTPS"
        return 1
    fi
    
    log_success "Configuration validation passed"
}

# Function to display summary
display_summary() {
    log_success "Configuration merge completed successfully!"
    echo ""
    log_info "Generated files:"
    echo "  - Complete JSON config: $OUTPUT_CONFIG_FILE"
    echo "  - Environment variables: $OUTPUT_ENV_FILE"
    echo "  - Azure Function settings: $CONFIG_DIR/azure-function-settings.json"
    echo "  - Lambda environment: $CONFIG_DIR/lambda-environment.json"
    echo "  - Docker Compose: $CONFIG_DIR/docker-compose.yml"
    echo ""
    log_info "Configuration summary:"
    echo "  - Batch size: $BATCH_SIZE"
    echo "  - Max retries: $MAX_RETRIES"
    echo "  - Normalization: $ENABLE_NORMALIZATION"
    echo "  - Deduplication: $DEDUPLICATION_ENABLED"
    if [ "$DEDUPLICATION_ENABLED" = "true" ]; then
        echo "    - Strategy: $DEDUPLICATION_STRATEGY"
        echo "    - Cache size: $DEDUPLICATION_CACHE_SIZE"
    fi
    echo "  - Monitoring: $MONITORING_ENABLED"
    echo "  - Health check port: $HEALTH_CHECK_PORT"
    echo ""
    log_info "Next steps:"
    echo "1. Review the generated configuration files"
    echo "2. Choose your deployment method (Azure Function, Lambda, Container)"
    echo "3. Deploy the worker using the appropriate configuration"
    echo "4. Run the validation script to test the integration"
}

# Main execution
main() {
    log_info "Starting configuration merge for GuardDuty-Sentinel integration..."
    echo ""
    
    check_prerequisites
    load_existing_configurations
    get_user_preferences
    
    echo ""
    log_info "Generating configuration files..."
    create_json_configuration
    create_env_configuration
    create_deployment_configurations
    
    echo ""
    validate_configuration
    display_summary
    
    log_success "Configuration merge completed successfully!"
}

# Run main function
main "$@"