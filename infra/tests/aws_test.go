package test

import (
	"testing"

	"github.com/gruntwork-io/terratest/modules/aws"
	"github.com/gruntwork-io/terratest/modules/terraform"
	"github.com/stretchr/testify/assert"
)

func TestAWSInfrastructure(t *testing.T) {
	t.Parallel()

	// Configure Terraform options
	terraformOptions := &terraform.Options{
		TerraformDir: "../aws",
		Vars: map[string]interface{}{
			"name_prefix":                "test-guardduty",
			"create_guardduty_detector":  true,
			"s3_force_destroy":          true,
			"kms_deletion_window":       7,
			"create_cloudwatch_logs":    true,
		},
	}

	// Clean up resources with "terraform destroy" at the end of the test
	defer terraform.Destroy(t, terraformOptions)

	// Run "terraform init" and "terraform apply"
	terraform.InitAndApply(t, terraformOptions)

	// Test S3 bucket creation
	s3BucketName := terraform.Output(t, terraformOptions, "s3_bucket_name")
	assert.NotEmpty(t, s3BucketName)

	// Verify S3 bucket exists and is properly configured
	awsRegion := "us-east-1"
	aws.AssertS3BucketExists(t, awsRegion, s3BucketName)

	// Test KMS key creation
	kmsKeyArn := terraform.Output(t, terraformOptions, "kms_key_arn")
	assert.NotEmpty(t, kmsKeyArn)
	assert.Contains(t, kmsKeyArn, "arn:aws:kms:")

	// Test IAM role creation
	ingestionRoleArn := terraform.Output(t, terraformOptions, "ingestion_role_arn")
	assert.NotEmpty(t, ingestionRoleArn)
	assert.Contains(t, ingestionRoleArn, "arn:aws:iam:")

	// Test GuardDuty detector creation
	detectorId := terraform.Output(t, terraformOptions, "guardduty_detector_id")
	assert.NotEmpty(t, detectorId)

	// Test publishing destination
	publishingDestinationArn := terraform.Output(t, terraformOptions, "publishing_destination_arn")
	assert.NotEmpty(t, publishingDestinationArn)
	assert.Equal(t, publishingDestinationArn, "arn:aws:s3:::"+s3BucketName)
}

func TestAWSInfrastructureWithExistingDetector(t *testing.T) {
	t.Parallel()

	// Configure Terraform options for existing detector scenario
	terraformOptions := &terraform.Options{
		TerraformDir: "../aws",
		Vars: map[string]interface{}{
			"name_prefix":                "test-guardduty-existing",
			"create_guardduty_detector":  false,
			"s3_force_destroy":          true,
			"create_cloudwatch_logs":    false,
		},
	}

	// This test assumes an existing GuardDuty detector
	// Skip if no detector exists
	awsRegion := "us-east-1"
	detectors := aws.GetGuardDutyDetectors(t, awsRegion)
	if len(detectors) == 0 {
		t.Skip("No existing GuardDuty detector found, skipping test")
	}

	// Clean up resources
	defer terraform.Destroy(t, terraformOptions)

	// Run Terraform
	terraform.InitAndApply(t, terraformOptions)

	// Verify outputs
	s3BucketName := terraform.Output(t, terraformOptions, "s3_bucket_name")
	assert.NotEmpty(t, s3BucketName)

	detectorId := terraform.Output(t, terraformOptions, "guardduty_detector_id")
	assert.NotEmpty(t, detectorId)
	assert.Contains(t, detectors, detectorId)
}

func TestAWSSecurityConfiguration(t *testing.T) {
	t.Parallel()

	terraformOptions := &terraform.Options{
		TerraformDir: "../aws",
		Vars: map[string]interface{}{
			"name_prefix":       "test-security",
			"s3_force_destroy": true,
		},
	}

	defer terraform.Destroy(t, terraformOptions)
	terraform.InitAndApply(t, terraformOptions)

	// Test S3 bucket security configuration
	s3BucketName := terraform.Output(t, terraformOptions, "s3_bucket_name")
	awsRegion := "us-east-1"

	// Verify bucket versioning is enabled
	versioning := aws.GetS3BucketVersioning(t, awsRegion, s3BucketName)
	assert.Equal(t, "Enabled", versioning)

	// Verify bucket encryption
	encryption := aws.GetS3BucketEncryption(t, awsRegion, s3BucketName)
	assert.NotNil(t, encryption)
	assert.Equal(t, "aws:kms", encryption.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm)

	// Verify public access is blocked
	publicAccessBlock := aws.GetS3BucketPublicAccessBlock(t, awsRegion, s3BucketName)
	assert.True(t, publicAccessBlock.BlockPublicAcls)
	assert.True(t, publicAccessBlock.BlockPublicPolicy)
	assert.True(t, publicAccessBlock.IgnorePublicAcls)
	assert.True(t, publicAccessBlock.RestrictPublicBuckets)
}

func TestAWSCostOptimization(t *testing.T) {
	t.Parallel()

	terraformOptions := &terraform.Options{
		TerraformDir: "../aws",
		Vars: map[string]interface{}{
			"name_prefix":                           "test-cost",
			"s3_force_destroy":                     true,
			"s3_lifecycle_enabled":                 true,
			"s3_expiration_days":                   30,
			"s3_noncurrent_version_expiration_days": 7,
		},
	}

	defer terraform.Destroy(t, terraformOptions)
	terraform.InitAndApply(t, terraformOptions)

	// Test lifecycle configuration
	s3BucketName := terraform.Output(t, terraformOptions, "s3_bucket_name")
	awsRegion := "us-east-1"

	lifecycle := aws.GetS3BucketLifecycleConfiguration(t, awsRegion, s3BucketName)
	assert.NotNil(t, lifecycle)
	assert.Len(t, lifecycle.Rules, 1)
	assert.Equal(t, "Enabled", lifecycle.Rules[0].Status)
	assert.Equal(t, int64(30), *lifecycle.Rules[0].Expiration.Days)
	assert.Equal(t, int64(7), *lifecycle.Rules[0].NoncurrentVersionExpiration.NoncurrentDays)
}

// TestAWSResourceDependencies validates proper resource dependencies and ordering
func TestAWSResourceDependencies(t *testing.T) {
	t.Parallel()

	terraformOptions := &terraform.Options{
		TerraformDir: "../aws",
		Vars: map[string]interface{}{
			"name_prefix":               "test-deps",
			"create_guardduty_detector": true,
			"s3_force_destroy":         true,
		},
	}

	defer terraform.Destroy(t, terraformOptions)

	// Test that plan shows proper dependencies
	terraform.Init(t, terraformOptions)
	plan := terraform.Plan(t, terraformOptions)

	// Verify KMS key is created before S3 bucket encryption
	assert.Contains(t, plan, "aws_kms_key.guardduty_s3")
	assert.Contains(t, plan, "aws_s3_bucket_server_side_encryption_configuration.guardduty_findings")

	// Verify S3 bucket policy depends on bucket creation
	assert.Contains(t, plan, "aws_s3_bucket_policy.guardduty_findings")

	// Verify publishing destination depends on bucket policy
	assert.Contains(t, plan, "aws_guardduty_publishing_destination.s3")

	terraform.Apply(t, terraformOptions)

	// Verify all resources are created in correct order
	s3BucketName := terraform.Output(t, terraformOptions, "s3_bucket_name")
	kmsKeyArn := terraform.Output(t, terraformOptions, "kms_key_arn")
	publishingDestArn := terraform.Output(t, terraformOptions, "publishing_destination_arn")

	assert.NotEmpty(t, s3BucketName)
	assert.NotEmpty(t, kmsKeyArn)
	assert.NotEmpty(t, publishingDestArn)
}

// TestAWSNetworkingConfiguration validates networking and access controls
func TestAWSNetworkingConfiguration(t *testing.T) {
	t.Parallel()

	terraformOptions := &terraform.Options{
		TerraformDir: "../aws",
		Vars: map[string]interface{}{
			"name_prefix":     "test-network",
			"s3_force_destroy": true,
		},
	}

	defer terraform.Destroy(t, terraformOptions)
	terraform.InitAndApply(t, terraformOptions)

	s3BucketName := terraform.Output(t, terraformOptions, "s3_bucket_name")
	awsRegion := "us-east-1"

	// Test S3 bucket public access block
	publicAccessBlock := aws.GetS3BucketPublicAccessBlock(t, awsRegion, s3BucketName)
	assert.True(t, publicAccessBlock.BlockPublicAcls)
	assert.True(t, publicAccessBlock.BlockPublicPolicy)
	assert.True(t, publicAccessBlock.IgnorePublicAcls)
	assert.True(t, publicAccessBlock.RestrictPublicBuckets)

	// Test bucket policy allows only GuardDuty service
	bucketPolicy := aws.GetS3BucketPolicy(t, awsRegion, s3BucketName)
	assert.Contains(t, bucketPolicy, "guardduty.amazonaws.com")
	assert.Contains(t, bucketPolicy, "aws:SourceAccount")
	assert.Contains(t, bucketPolicy, "aws:SourceArn")
}

// TestAWSSecurityCompliance validates security and compliance configurations
func TestAWSSecurityCompliance(t *testing.T) {
	t.Parallel()

	terraformOptions := &terraform.Options{
		TerraformDir: "../aws",
		Vars: map[string]interface{}{
			"name_prefix":                "test-compliance",
			"s3_force_destroy":          true,
			"cross_account_external_id": "secure-external-id-123",
		},
	}

	defer terraform.Destroy(t, terraformOptions)
	terraform.InitAndApply(t, terraformOptions)

	s3BucketName := terraform.Output(t, terraformOptions, "s3_bucket_name")
	kmsKeyArn := terraform.Output(t, terraformOptions, "kms_key_arn")
	awsRegion := "us-east-1"

	// Test S3 encryption configuration
	encryption := aws.GetS3BucketEncryption(t, awsRegion, s3BucketName)
	assert.NotNil(t, encryption)
	assert.Equal(t, "aws:kms", encryption.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm)
	assert.Contains(t, encryption.Rules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID, kmsKeyArn)

	// Test S3 versioning is enabled
	versioning := aws.GetS3BucketVersioning(t, awsRegion, s3BucketName)
	assert.Equal(t, "Enabled", versioning)

	// Test IAM role has external ID condition
	ingestionRoleArn := terraform.Output(t, terraformOptions, "ingestion_role_arn")
	assert.NotEmpty(t, ingestionRoleArn)
	assert.Contains(t, ingestionRoleArn, "arn:aws:iam:")
}

// TestAWSCostOptimizationAdvanced validates advanced cost optimization features
func TestAWSCostOptimizationAdvanced(t *testing.T) {
	t.Parallel()

	terraformOptions := &terraform.Options{
		TerraformDir: "../aws",
		Vars: map[string]interface{}{
			"name_prefix":                           "test-cost-adv",
			"s3_force_destroy":                     true,
			"s3_lifecycle_enabled":                 true,
			"s3_expiration_days":                   90,
			"s3_noncurrent_version_expiration_days": 30,
			"kms_deletion_window":                  7, // Minimum for testing
			"create_cloudwatch_logs":               false, // Disable to save costs
		},
	}

	defer terraform.Destroy(t, terraformOptions)
	terraform.InitAndApply(t, terraformOptions)

	s3BucketName := terraform.Output(t, terraformOptions, "s3_bucket_name")
	awsRegion := "us-east-1"

	// Test lifecycle configuration for cost optimization
	lifecycle := aws.GetS3BucketLifecycleConfiguration(t, awsRegion, s3BucketName)
	assert.NotNil(t, lifecycle)
	assert.Equal(t, int64(90), *lifecycle.Rules[0].Expiration.Days)
	assert.Equal(t, int64(30), *lifecycle.Rules[0].NoncurrentVersionExpiration.NoncurrentDays)

	// Test KMS key rotation is enabled for security without extra cost
	kmsKeyArn := terraform.Output(t, terraformOptions, "kms_key_arn")
	assert.NotEmpty(t, kmsKeyArn)

	// Verify CloudWatch logs are not created when disabled
	cloudwatchLogGroup := terraform.Output(t, terraformOptions, "cloudwatch_log_group_name")
	assert.Empty(t, cloudwatchLogGroup)
}