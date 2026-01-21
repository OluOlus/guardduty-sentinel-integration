#!/bin/bash

# GuardDuty to Sentinel Integration - AWS Resources Setup Script
# This script automates the creation of AWS resources for manual deployment

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
OUTPUT_FILE="$CONFIG_DIR/generated-aws-config.json"

# Default values
DEFAULT_REGION="us-east-1"
DEFAULT_BUCKET_PREFIX="guardduty-export-$(date +%s)"
DEFAULT_KMS_ALIAS="guardduty-s3-export"

# Function to check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check AWS CLI
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI is not installed. Please install it first."
        exit 1
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        log_error "AWS credentials not configured. Run 'aws configure' first."
        exit 1
    fi
    
    # Check jq
    if ! command -v jq &> /dev/null; then
        log_error "jq is not installed. Please install it for JSON processing."
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

# Function to get user input with defaults
get_user_input() {
    log_info "Gathering configuration..."
    
    # AWS Region
    read -p "AWS Region [$DEFAULT_REGION]: " AWS_REGION
    AWS_REGION=${AWS_REGION:-$DEFAULT_REGION}
    
    # S3 Bucket Name
    read -p "S3 Bucket Name [$DEFAULT_BUCKET_PREFIX]: " BUCKET_NAME
    BUCKET_NAME=${BUCKET_NAME:-$DEFAULT_BUCKET_PREFIX}
    
    # KMS Key (optional)
    read -p "Create custom KMS key? (y/N): " CREATE_KMS
    CREATE_KMS=${CREATE_KMS:-n}
    
    if [[ $CREATE_KMS =~ ^[Yy]$ ]]; then
        read -p "KMS Key Alias [$DEFAULT_KMS_ALIAS]: " KMS_ALIAS
        KMS_ALIAS=${KMS_ALIAS:-$DEFAULT_KMS_ALIAS}
        USE_CUSTOM_KMS=true
    else
        USE_CUSTOM_KMS=false
    fi
    
    # Get account ID
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    
    log_info "Configuration:"
    log_info "  AWS Region: $AWS_REGION"
    log_info "  S3 Bucket: $BUCKET_NAME"
    log_info "  Account ID: $ACCOUNT_ID"
    log_info "  Custom KMS: $USE_CUSTOM_KMS"
    if [ "$USE_CUSTOM_KMS" = true ]; then
        log_info "  KMS Alias: $KMS_ALIAS"
    fi
    
    read -p "Continue with this configuration? (Y/n): " CONFIRM
    CONFIRM=${CONFIRM:-y}
    
    if [[ ! $CONFIRM =~ ^[Yy]$ ]]; then
        log_info "Setup cancelled by user"
        exit 0
    fi
}

# Function to create KMS key
create_kms_key() {
    if [ "$USE_CUSTOM_KMS" = true ]; then
        log_info "Creating KMS key..."
        
        # Create key policy
        cat > /tmp/kms-key-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "Enable IAM User Permissions",
            "Effect": "Allow",
            "Principal": {
                "AWS": "arn:aws:iam::$ACCOUNT_ID:root"
            },
            "Action": "kms:*",
            "Resource": "*"
        },
        {
            "Sid": "AllowGuardDutyKey",
            "Effect": "Allow",
            "Principal": {
                "Service": "guardduty.amazonaws.com"
            },
            "Action": [
                "kms:GenerateDataKey",
                "kms:Decrypt"
            ],
            "Resource": "*",
            "Condition": {
                "StringEquals": {
                    "aws:SourceAccount": "$ACCOUNT_ID"
                }
            }
        }
    ]
}
EOF
        
        # Create KMS key
        KMS_KEY_OUTPUT=$(aws kms create-key \
            --description "GuardDuty S3 Export Encryption Key" \
            --key-usage ENCRYPT_DECRYPT \
            --key-spec SYMMETRIC_DEFAULT \
            --policy file:///tmp/kms-key-policy.json \
            --region $AWS_REGION)
        
        KMS_KEY_ID=$(echo $KMS_KEY_OUTPUT | jq -r '.KeyMetadata.KeyId')
        KMS_KEY_ARN=$(echo $KMS_KEY_OUTPUT | jq -r '.KeyMetadata.Arn')
        
        # Create alias
        aws kms create-alias \
            --alias-name alias/$KMS_ALIAS \
            --target-key-id $KMS_KEY_ID \
            --region $AWS_REGION
        
        log_success "KMS key created: $KMS_KEY_ARN"
        
        # Cleanup
        rm -f /tmp/kms-key-policy.json
    else
        KMS_KEY_ARN=""
        log_info "Using AWS managed KMS key"
    fi
}

# Function to create S3 bucket
create_s3_bucket() {
    log_info "Creating S3 bucket..."
    
    # Create bucket
    if [ "$AWS_REGION" = "us-east-1" ]; then
        aws s3 mb s3://$BUCKET_NAME
    else
        aws s3 mb s3://$BUCKET_NAME --region $AWS_REGION
    fi
    
    # Enable versioning
    aws s3api put-bucket-versioning \
        --bucket $BUCKET_NAME \
        --versioning-configuration Status=Enabled
    
    # Configure encryption
    if [ "$USE_CUSTOM_KMS" = true ]; then
        aws s3api put-bucket-encryption \
            --bucket $BUCKET_NAME \
            --server-side-encryption-configuration "{
                \"Rules\": [
                    {
                        \"ApplyServerSideEncryptionByDefault\": {
                            \"SSEAlgorithm\": \"aws:kms\",
                            \"KMSMasterKeyID\": \"$KMS_KEY_ARN\"
                        },
                        \"BucketKeyEnabled\": true
                    }
                ]
            }"
    else
        aws s3api put-bucket-encryption \
            --bucket $BUCKET_NAME \
            --server-side-encryption-configuration '{
                "Rules": [
                    {
                        "ApplyServerSideEncryptionByDefault": {
                            "SSEAlgorithm": "aws:kms"
                        },
                        "BucketKeyEnabled": true
                    }
                ]
            }'
    fi
    
    # Create bucket policy
    cat > /tmp/s3-bucket-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "AllowGuardDutyGetBucketLocation",
            "Effect": "Allow",
            "Principal": {
                "Service": "guardduty.amazonaws.com"
            },
            "Action": "s3:GetBucketLocation",
            "Resource": "arn:aws:s3:::$BUCKET_NAME",
            "Condition": {
                "StringEquals": {
                    "aws:SourceAccount": "$ACCOUNT_ID"
                }
            }
        },
        {
            "Sid": "AllowGuardDutyPutObject",
            "Effect": "Allow",
            "Principal": {
                "Service": "guardduty.amazonaws.com"
            },
            "Action": "s3:PutObject",
            "Resource": "arn:aws:s3:::$BUCKET_NAME/*",
            "Condition": {
                "StringEquals": {
                    "aws:SourceAccount": "$ACCOUNT_ID"
                }
            }
        }
    ]
}
EOF
    
    # Apply bucket policy
    aws s3api put-bucket-policy \
        --bucket $BUCKET_NAME \
        --policy file:///tmp/s3-bucket-policy.json
    
    log_success "S3 bucket created and configured: $BUCKET_NAME"
    
    # Cleanup
    rm -f /tmp/s3-bucket-policy.json
}

# Function to configure GuardDuty
configure_guardduty() {
    log_info "Configuring GuardDuty..."
    
    # Get or create detector
    DETECTOR_ID=$(aws guardduty list-detectors --query 'DetectorIds[0]' --output text --region $AWS_REGION)
    
    if [ "$DETECTOR_ID" = "None" ] || [ -z "$DETECTOR_ID" ]; then
        log_info "Creating GuardDuty detector..."
        DETECTOR_OUTPUT=$(aws guardduty create-detector --enable --region $AWS_REGION)
        DETECTOR_ID=$(echo $DETECTOR_OUTPUT | jq -r '.DetectorId')
    fi
    
    log_info "GuardDuty Detector ID: $DETECTOR_ID"
    
    # Create publishing destination
    if [ "$USE_CUSTOM_KMS" = true ]; then
        DESTINATION_OUTPUT=$(aws guardduty create-publishing-destination \
            --detector-id $DETECTOR_ID \
            --destination-type S3 \
            --destination-properties DestinationArn=arn:aws:s3:::$BUCKET_NAME,KmsKeyArn=$KMS_KEY_ARN \
            --region $AWS_REGION)
    else
        DESTINATION_OUTPUT=$(aws guardduty create-publishing-destination \
            --detector-id $DETECTOR_ID \
            --destination-type S3 \
            --destination-properties DestinationArn=arn:aws:s3:::$BUCKET_NAME \
            --region $AWS_REGION)
    fi
    
    DESTINATION_ID=$(echo $DESTINATION_OUTPUT | jq -r '.DestinationId')
    
    log_success "GuardDuty publishing destination created: $DESTINATION_ID"
}

# Function to create IAM role
create_iam_role() {
    log_info "Creating IAM role for worker..."
    
    # Create trust policy
    cat > /tmp/worker-trust-policy.json << 'EOF'
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {
                "Service": [
                    "lambda.amazonaws.com",
                    "ecs-tasks.amazonaws.com"
                ]
            },
            "Action": "sts:AssumeRole"
        }
    ]
}
EOF
    
    # Create role
    aws iam create-role \
        --role-name GuardDutySentinelWorkerRole \
        --assume-role-policy-document file:///tmp/worker-trust-policy.json
    
    # Create permissions policy
    if [ "$USE_CUSTOM_KMS" = true ]; then
        cat > /tmp/worker-permissions-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:GetObject",
                "s3:ListBucket"
            ],
            "Resource": [
                "arn:aws:s3:::$BUCKET_NAME",
                "arn:aws:s3:::$BUCKET_NAME/*"
            ]
        },
        {
            "Effect": "Allow",
            "Action": [
                "kms:Decrypt",
                "kms:GenerateDataKey"
            ],
            "Resource": "$KMS_KEY_ARN"
        },
        {
            "Effect": "Allow",
            "Action": [
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents"
            ],
            "Resource": "arn:aws:logs:*:*:*"
        }
    ]
}
EOF
    else
        cat > /tmp/worker-permissions-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:GetObject",
                "s3:ListBucket"
            ],
            "Resource": [
                "arn:aws:s3:::$BUCKET_NAME",
                "arn:aws:s3:::$BUCKET_NAME/*"
            ]
        },
        {
            "Effect": "Allow",
            "Action": [
                "kms:Decrypt",
                "kms:GenerateDataKey"
            ],
            "Resource": "arn:aws:kms:$AWS_REGION:$ACCOUNT_ID:key/*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents"
            ],
            "Resource": "arn:aws:logs:*:*:*"
        }
    ]
}
EOF
    fi
    
    # Attach policy to role
    aws iam put-role-policy \
        --role-name GuardDutySentinelWorkerRole \
        --policy-name GuardDutySentinelWorkerPolicy \
        --policy-document file:///tmp/worker-permissions-policy.json
    
    WORKER_ROLE_ARN="arn:aws:iam::$ACCOUNT_ID:role/GuardDutySentinelWorkerRole"
    
    log_success "IAM role created: $WORKER_ROLE_ARN"
    
    # Cleanup
    rm -f /tmp/worker-trust-policy.json /tmp/worker-permissions-policy.json
}

# Function to generate configuration
generate_configuration() {
    log_info "Generating configuration file..."
    
    # Create config directory if it doesn't exist
    mkdir -p $CONFIG_DIR
    
    # Generate configuration JSON
    cat > $OUTPUT_FILE << EOF
{
  "aws": {
    "region": "$AWS_REGION",
    "s3BucketName": "$BUCKET_NAME",
    "s3BucketPrefix": "AWSLogs/$ACCOUNT_ID/GuardDuty/",
    "kmsKeyArn": "$KMS_KEY_ARN",
    "workerRoleArn": "$WORKER_ROLE_ARN"
  },
  "guardduty": {
    "detectorId": "$DETECTOR_ID",
    "destinationId": "$DESTINATION_ID"
  },
  "metadata": {
    "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "createdBy": "setup-aws-resources.sh",
    "accountId": "$ACCOUNT_ID",
    "region": "$AWS_REGION"
  }
}
EOF
    
    log_success "Configuration saved to: $OUTPUT_FILE"
}

# Function to create test finding
create_test_finding() {
    log_info "Creating test GuardDuty finding..."
    
    aws guardduty create-sample-findings \
        --detector-id $DETECTOR_ID \
        --finding-types "Backdoor:EC2/XORDDOS" \
        --region $AWS_REGION
    
    log_success "Test finding created. Check S3 bucket in 5-10 minutes."
    log_info "Expected S3 path: s3://$BUCKET_NAME/AWSLogs/$ACCOUNT_ID/GuardDuty/$AWS_REGION/"
}

# Function to display next steps
display_next_steps() {
    log_success "AWS setup completed successfully!"
    echo ""
    log_info "Next steps:"
    echo "1. Proceed to Azure setup: ../azure-setup.md"
    echo "2. Configure the ingestion worker with the generated configuration"
    echo "3. Run the validation script to test the integration"
    echo ""
    log_info "Generated files:"
    echo "- Configuration: $OUTPUT_FILE"
    echo ""
    log_info "Resources created:"
    echo "- S3 Bucket: $BUCKET_NAME"
    if [ "$USE_CUSTOM_KMS" = true ]; then
        echo "- KMS Key: $KMS_KEY_ARN"
    fi
    echo "- GuardDuty Detector: $DETECTOR_ID"
    echo "- Publishing Destination: $DESTINATION_ID"
    echo "- IAM Role: $WORKER_ROLE_ARN"
}

# Function to cleanup on error
cleanup_on_error() {
    log_error "Setup failed. Cleaning up resources..."
    
    # Note: This is a basic cleanup. In production, you might want more sophisticated cleanup
    if [ -n "$BUCKET_NAME" ]; then
        log_warning "Manual cleanup required for S3 bucket: $BUCKET_NAME"
    fi
    
    if [ -n "$KMS_KEY_ID" ] && [ "$USE_CUSTOM_KMS" = true ]; then
        log_warning "Manual cleanup required for KMS key: $KMS_KEY_ID"
    fi
    
    exit 1
}

# Main execution
main() {
    log_info "Starting AWS resources setup for GuardDuty-Sentinel integration..."
    
    # Set error trap
    trap cleanup_on_error ERR
    
    check_prerequisites
    get_user_input
    create_kms_key
    create_s3_bucket
    configure_guardduty
    create_iam_role
    generate_configuration
    create_test_finding
    display_next_steps
    
    log_success "Setup completed successfully!"
}

# Run main function
main "$@"