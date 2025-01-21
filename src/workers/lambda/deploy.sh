#!/bin/bash

# AWS Lambda deployment script for GuardDuty to Sentinel integration
# This script deploys the Lambda worker using AWS SAM

set -e

# Configuration
STACK_NAME="${AWS_STACK_NAME:-guardduty-sentinel-lambda}"
REGION="${AWS_REGION:-us-east-1}"
S3_BUCKET="${SAM_DEPLOYMENT_BUCKET:-guardduty-sentinel-deployments}"

echo "🚀 Deploying GuardDuty Sentinel Lambda Worker"
echo "Stack Name: $STACK_NAME"
echo "Region: $REGION"
echo "S3 Bucket: $S3_BUCKET"

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI is not installed. Please install it first."
    exit 1
fi

# Check if SAM CLI is installed
if ! command -v sam &> /dev/null; then
    echo "❌ AWS SAM CLI is not installed. Please install it first."
    exit 1
fi

# Check if logged in to AWS
if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ Not logged in to AWS. Please run 'aws configure' or set credentials."
    exit 1
fi

# Validate required environment variables
REQUIRED_VARS=(
    "AZURE_TENANT_ID"
    "AZURE_CLIENT_ID" 
    "AZURE_CLIENT_SECRET"
    "AZURE_WORKSPACE_ID"
    "AZURE_SUBSCRIPTION_ID"
    "AZURE_RESOURCE_GROUP_NAME"
    "AZURE_DCR_IMMUTABLE_ID"
    "AZURE_DCR_STREAM_NAME"
    "AWS_S3_BUCKET_NAME"
)

echo "🔍 Validating required environment variables..."
for var in "${REQUIRED_VARS[@]}"; do
    if [[ -z "${!var}" ]]; then
        echo "❌ Required environment variable $var is not set"
        exit 1
    fi
done

echo "✅ All required environment variables are set"

# Create S3 bucket for SAM deployments if it doesn't exist
echo "📦 Creating S3 deployment bucket if needed..."
if ! aws s3 ls "s3://$S3_BUCKET" 2>/dev/null; then
    aws s3 mb "s3://$S3_BUCKET" --region "$REGION"
    echo "✅ Created S3 bucket: $S3_BUCKET"
else
    echo "✅ S3 bucket already exists: $S3_BUCKET"
fi

# Build the Lambda function
echo "🔨 Building Lambda function..."
npm run build

# Package the SAM application
echo "📦 Packaging SAM application..."
sam build --use-container

# Deploy the SAM application
echo "🚀 Deploying SAM application..."
sam deploy \
    --stack-name "$STACK_NAME" \
    --s3-bucket "$S3_BUCKET" \
    --region "$REGION" \
    --capabilities CAPABILITY_IAM \
    --parameter-overrides \
        AzureTenantId="$AZURE_TENANT_ID" \
        AzureClientId="$AZURE_CLIENT_ID" \
        AzureClientSecret="$AZURE_CLIENT_SECRET" \
        AzureWorkspaceId="$AZURE_WORKSPACE_ID" \
        AzureSubscriptionId="$AZURE_SUBSCRIPTION_ID" \
        AzureResourceGroupName="$AZURE_RESOURCE_GROUP_NAME" \
        AzureDcrImmutableId="$AZURE_DCR_IMMUTABLE_ID" \
        AzureDcrStreamName="$AZURE_DCR_STREAM_NAME" \
        S3BucketName="$AWS_S3_BUCKET_NAME" \
        S3BucketPrefix="${AWS_S3_BUCKET_PREFIX:-AWSLogs/}" \
        KmsKeyArn="${AWS_KMS_KEY_ARN:-}" \
        BatchSize="${BATCH_SIZE:-50}" \
        EnableNormalization="${ENABLE_NORMALIZATION:-false}" \
        EnableDeduplication="${ENABLE_DEDUPLICATION:-true}" \
        LogLevel="${LOG_LEVEL:-info}" \
    --confirm-changeset \
    --fail-on-empty-changeset

# Get stack outputs
echo "📋 Getting stack outputs..."
OUTPUTS=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --query 'Stacks[0].Outputs' \
    --output json)

PROCESSOR_FUNCTION_ARN=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="GuardDutyProcessorFunction") | .OutputValue')
HEALTH_FUNCTION_ARN=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="HealthCheckFunction") | .OutputValue')
API_URL=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="ApiGatewayUrl") | .OutputValue')
HEALTH_URL=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="HealthCheckUrl") | .OutputValue')
MANUAL_URL=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="ManualProcessingUrl") | .OutputValue')
DLQ_URL=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="ProcessingDLQUrl") | .OutputValue')
DASHBOARD_URL=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="DashboardUrl") | .OutputValue')

echo ""
echo "✅ Deployment completed successfully!"
echo ""
echo "📋 Lambda Functions:"
echo "   Processor: $PROCESSOR_FUNCTION_ARN"
echo "   Health Check: $HEALTH_FUNCTION_ARN"
echo ""
echo "🔗 API Endpoints:"
echo "   API Gateway: $API_URL"
echo "   Health Check: $HEALTH_URL"
echo "   Manual Processing: $MANUAL_URL"
echo ""
echo "📊 Monitoring:"
echo "   Dead Letter Queue: $DLQ_URL"
echo "   CloudWatch Dashboard: $DASHBOARD_URL"
echo ""
echo "🔧 Next Steps:"
echo "   1. Test health endpoint: curl '$HEALTH_URL'"
echo "   2. Configure S3 bucket notifications (if not automatic)"
echo "   3. Monitor CloudWatch logs and metrics"
echo "   4. Set up CloudWatch alarms for errors"
echo ""

# Test health endpoint
echo "🏥 Testing health endpoint..."
if curl -s -f "$HEALTH_URL" > /dev/null; then
    echo "✅ Health check passed"
else
    echo "⚠️  Health check failed - check Lambda logs"
fi

# Optional: Set up CloudWatch alarms
read -p "🚨 Set up CloudWatch alarms for monitoring? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "📊 Creating CloudWatch alarms..."
    
    # Error rate alarm
    aws cloudwatch put-metric-alarm \
        --alarm-name "${STACK_NAME}-error-rate" \
        --alarm-description "GuardDuty Lambda error rate" \
        --metric-name Errors \
        --namespace AWS/Lambda \
        --statistic Sum \
        --period 300 \
        --threshold 5 \
        --comparison-operator GreaterThanThreshold \
        --evaluation-periods 2 \
        --dimensions Name=FunctionName,Value="${STACK_NAME}-guardduty-processor" \
        --region "$REGION"
    
    # Duration alarm
    aws cloudwatch put-metric-alarm \
        --alarm-name "${STACK_NAME}-duration" \
        --alarm-description "GuardDuty Lambda duration" \
        --metric-name Duration \
        --namespace AWS/Lambda \
        --statistic Average \
        --period 300 \
        --threshold 240000 \
        --comparison-operator GreaterThanThreshold \
        --evaluation-periods 2 \
        --dimensions Name=FunctionName,Value="${STACK_NAME}-guardduty-processor" \
        --region "$REGION"
    
    echo "✅ CloudWatch alarms created"
fi

echo ""
echo "🎉 Lambda deployment complete!"
echo ""
echo "📝 Configuration Summary:"
echo "   Stack: $STACK_NAME"
echo "   Region: $REGION"
echo "   S3 Bucket: $AWS_S3_BUCKET_NAME"
echo "   Batch Size: ${BATCH_SIZE:-50}"
echo "   Normalization: ${ENABLE_NORMALIZATION:-false}"
echo "   Deduplication: ${ENABLE_DEDUPLICATION:-true}"