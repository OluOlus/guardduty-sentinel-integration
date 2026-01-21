package test

import (
	"testing"

	"github.com/gruntwork-io/terratest/modules/terraform"
	"github.com/stretchr/testify/assert"
)

func TestCompleteIntegration(t *testing.T) {
	t.Parallel()

	// Test the complete deployment example
	terraformOptions := &terraform.Options{
		TerraformDir: "../examples/complete-deployment",
		Vars: map[string]interface{}{
			"name_prefix":                "test-integration",
			"environment":               "test",
			"aws_region":                "us-east-1",
			"azure_location":            "East US",
			"create_guardduty_detector": true,
			"s3_retention_days":         30,
			"log_analytics_retention_days": 30,
			"enable_sentinel":           true,
			"enable_automation_rules":   true,
			"notification_emails": []string{
				"test@example.com",
			},
		},
	}

	// Clean up resources
	defer terraform.Destroy(t, terraformOptions)

	// Run Terraform
	terraform.InitAndApply(t, terraformOptions)

	// Test AWS outputs
	awsConfig := terraform.OutputMap(t, terraformOptions, "aws_configuration")
	assert.NotEmpty(t, awsConfig["guardduty_detector_id"])
	assert.NotEmpty(t, awsConfig["s3_bucket_name"])
	assert.NotEmpty(t, awsConfig["kms_key_arn"])
	assert.NotEmpty(t, awsConfig["ingestion_role_arn"])

	// Test Azure outputs
	azureConfig := terraform.OutputMap(t, terraformOptions, "azure_configuration")
	assert.NotEmpty(t, azureConfig["resource_group_name"])
	assert.NotEmpty(t, azureConfig["log_analytics_workspace_id"])
	assert.NotEmpty(t, azureConfig["data_collection_endpoint_uri"])
	assert.NotEmpty(t, azureConfig["data_collection_rule_immutable_id"])

	// Test Sentinel outputs
	sentinelConfig := terraform.OutputMap(t, terraformOptions, "sentinel_configuration")
	assert.NotEmpty(t, sentinelConfig["sentinel_workspace_id"])
	assert.NotEmpty(t, sentinelConfig["action_group_id"])

	// Test worker configuration
	workerConfig := terraform.OutputMap(t, terraformOptions, "worker_configuration")
	assert.NotEmpty(t, workerConfig["aws_region"])
	assert.NotEmpty(t, workerConfig["s3_bucket_name"])
	assert.NotEmpty(t, workerConfig["tenant_id"])
	assert.NotEmpty(t, workerConfig["data_collection_endpoint_uri"])
	assert.NotEmpty(t, workerConfig["client_id"])

	// Test deployment summary
	deploymentSummary := terraform.OutputMap(t, terraformOptions, "deployment_summary")
	assert.Equal(t, "test", deploymentSummary["environment"])
	assert.Equal(t, "us-east-1", deploymentSummary["aws_region"])
	assert.Equal(t, "East US", deploymentSummary["azure_location"])
	assert.Equal(t, "true", deploymentSummary["sentinel_enabled"])
}

func TestNetworkingAndDependencies(t *testing.T) {
	t.Parallel()

	// Test resource dependencies and networking configuration
	terraformOptions := &terraform.Options{
		TerraformDir: "../examples/complete-deployment",
		Vars: map[string]interface{}{
			"name_prefix":                        "test-networking",
			"environment":                       "test",
			"dce_public_access":                 false, // Test private endpoint
			"enable_data_transformation":        true,
			"create_guardduty_detector":         false,
			"enable_application_insights":       true,
		},
	}

	// Validate configuration without applying (since it requires existing detector)
	terraform.Init(t, terraformOptions)
	plan := terraform.Plan(t, terraformOptions)

	// Verify private endpoint configuration
	assert.Contains(t, plan, "public_network_access_enabled = false")
	
	// Verify data transformation is enabled
	assert.Contains(t, plan, "enable_data_transformation")
	
	// Verify Application Insights is created
	assert.Contains(t, plan, "azurerm_application_insights")
}

func TestSecurityCompliance(t *testing.T) {
	t.Parallel()

	// Test security and compliance configuration
	terraformOptions := &terraform.Options{
		TerraformDir: "../examples/complete-deployment",
		Vars: map[string]interface{}{
			"name_prefix":                           "test-security",
			"environment":                          "test",
			"cross_account_external_id":            "secure-external-id-123",
			"s3_retention_days":                    90,
			"log_analytics_retention_days":         90,
			"sentinel_customer_managed_key_enabled": false,
		},
	}

	terraform.Init(t, terraformOptions)
	plan := terraform.Plan(t, terraformOptions)

	// Verify security configurations
	assert.Contains(t, plan, "cross_account_external_id")
	assert.Contains(t, plan, "block_public_acls")
	assert.Contains(t, plan, "enable_key_rotation = true")
	assert.Contains(t, plan, "sse_algorithm")
}

func TestCostOptimization(t *testing.T) {
	t.Parallel()

	// Test cost optimization settings
	terraformOptions := &terraform.Options{
		TerraformDir: "../examples/complete-deployment",
		Vars: map[string]interface{}{
			"name_prefix":                   "test-cost",
			"environment":                  "test",
			"s3_retention_days":            30, // Shorter retention for cost savings
			"log_analytics_retention_days": 30,
			"enable_application_insights":  false, // Disable to save costs
			"create_automation_rules":      false, // Minimal features
		},
	}

	terraform.Init(t, terraformOptions)
	plan := terraform.Plan(t, terraformOptions)

	// Verify cost optimization settings
	assert.Contains(t, plan, "s3_expiration_days = 30")
	assert.Contains(t, plan, "log_analytics_retention_days = 30")
	assert.NotContains(t, plan, "azurerm_application_insights")
}

func TestMultiRegionCompatibility(t *testing.T) {
	t.Parallel()

	// Test different region combinations
	testCases := []struct {
		name        string
		awsRegion   string
		azureRegion string
	}{
		{"US East", "us-east-1", "East US"},
		{"US West", "us-west-2", "West US 2"},
		{"Europe", "eu-west-1", "West Europe"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			terraformOptions := &terraform.Options{
				TerraformDir: "../examples/complete-deployment",
				Vars: map[string]interface{}{
					"name_prefix":    "test-" + tc.name,
					"environment":    "test",
					"aws_region":     tc.awsRegion,
					"azure_location": tc.azureRegion,
				},
			}

			terraform.Init(t, terraformOptions)
			plan := terraform.Plan(t, terraformOptions)

			// Verify regions are configured correctly
			assert.Contains(t, plan, tc.awsRegion)
			assert.Contains(t, plan, tc.azureRegion)
		})
	}
}

func TestErrorHandling(t *testing.T) {
	t.Parallel()

	// Test invalid configuration handling
	terraformOptions := &terraform.Options{
		TerraformDir: "../examples/complete-deployment",
		Vars: map[string]interface{}{
			"name_prefix":                   "test-error",
			"environment":                  "test",
			"log_analytics_retention_days": 15, // Invalid: below minimum of 30
		},
	}

	terraform.Init(t, terraformOptions)
	
	// This should fail validation
	_, err := terraform.PlanE(t, terraformOptions)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "retention must be between 30 and 730 days")
}

// TestTerraformValidation validates Terraform configuration syntax and structure
func TestTerraformValidation(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name string
		dir  string
	}{
		{"AWS Module", "../aws"},
		{"Azure Module", "../azure"},
		{"Sentinel Module", "../sentinel"},
		{"Complete Deployment", "../examples/complete-deployment"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			terraformOptions := &terraform.Options{
				TerraformDir: tc.dir,
			}

			// Test Terraform init and validate
			terraform.Init(t, terraformOptions)
			terraform.Validate(t, terraformOptions)

			// Test Terraform format check
			terraform.Format(t, terraformOptions)
		})
	}
}

// TestInfrastructureDeploymentValidation validates complete infrastructure deployment
func TestInfrastructureDeploymentValidation(t *testing.T) {
	t.Parallel()

	terraformOptions := &terraform.Options{
		TerraformDir: "../examples/complete-deployment",
		Vars: map[string]interface{}{
			"name_prefix":                "test-deploy-validation",
			"environment":               "test",
			"aws_region":                "us-east-1",
			"azure_location":            "East US",
			"create_guardduty_detector": true,
			"s3_retention_days":         30,
			"log_analytics_retention_days": 30,
			"enable_sentinel":           true,
			"enable_automation_rules":   false, // Disable for faster testing
			"notification_emails": []string{
				"test@example.com",
			},
		},
	}

	defer terraform.Destroy(t, terraformOptions)

	// Test deployment validation without full apply
	terraform.Init(t, terraformOptions)
	plan := terraform.Plan(t, terraformOptions)

	// Verify all major components are planned
	expectedResources := []string{
		"module.guardduty_aws.aws_s3_bucket.guardduty_findings",
		"module.guardduty_aws.aws_kms_key.guardduty_s3",
		"module.guardduty_aws.aws_guardduty_detector.main",
		"module.guardduty_azure.azurerm_log_analytics_workspace.main",
		"module.guardduty_azure.azurerm_monitor_data_collection_rule.main",
		"module.guardduty_sentinel.azurerm_monitor_action_group.guardduty_incidents",
	}

	for _, resource := range expectedResources {
		assert.Contains(t, plan, resource)
	}

	// Apply and validate outputs
	terraform.Apply(t, terraformOptions)

	// Test all required outputs are present
	awsConfig := terraform.OutputMap(t, terraformOptions, "aws_configuration")
	azureConfig := terraform.OutputMap(t, terraformOptions, "azure_configuration")
	workerConfig := terraform.OutputMap(t, terraformOptions, "worker_configuration")

	assert.NotEmpty(t, awsConfig["s3_bucket_name"])
	assert.NotEmpty(t, awsConfig["kms_key_arn"])
	assert.NotEmpty(t, azureConfig["log_analytics_workspace_id"])
	assert.NotEmpty(t, azureConfig["data_collection_rule_immutable_id"])
	assert.NotEmpty(t, workerConfig["data_collection_endpoint_uri"])
}

// TestResourceNamingConventions validates resource naming conventions
func TestResourceNamingConventions(t *testing.T) {
	t.Parallel()

	terraformOptions := &terraform.Options{
		TerraformDir: "../examples/complete-deployment",
		Vars: map[string]interface{}{
			"name_prefix": "test-naming",
			"environment": "dev",
		},
	}

	terraform.Init(t, terraformOptions)
	plan := terraform.Plan(t, terraformOptions)

	// Verify naming conventions
	assert.Contains(t, plan, "test-naming-guardduty-findings-dev")
	assert.Contains(t, plan, "test-naming-rg-dev")
	assert.Contains(t, plan, "test-naming-law-dev")
	assert.Contains(t, plan, "test-naming-dce")
	assert.Contains(t, plan, "test-naming-dcr")
}

// TestSecurityComplianceValidation validates security compliance across all modules
func TestSecurityComplianceValidation(t *testing.T) {
	t.Parallel()

	terraformOptions := &terraform.Options{
		TerraformDir: "../examples/complete-deployment",
		Vars: map[string]interface{}{
			"name_prefix":                           "test-security-compliance",
			"environment":                          "test",
			"cross_account_external_id":            "secure-external-id-123",
			"s3_retention_days":                    90,
			"log_analytics_retention_days":         90,
			"sentinel_customer_managed_key_enabled": false,
			"dce_public_access":                    false, // Private access only
		},
	}

	terraform.Init(t, terraformOptions)
	plan := terraform.Plan(t, terraformOptions)

	// Verify security configurations
	securityChecks := []string{
		"cross_account_external_id",
		"block_public_acls = true",
		"enable_key_rotation = true",
		"sse_algorithm = \"aws:kms\"",
		"public_network_access_enabled = false",
		"customer_managed_key_enabled = false",
	}

	for _, check := range securityChecks {
		assert.Contains(t, plan, check)
	}
}

// TestCostOptimizationValidation validates cost optimization across all modules
func TestCostOptimizationValidation(t *testing.T) {
	t.Parallel()

	terraformOptions := &terraform.Options{
		TerraformDir: "../examples/complete-deployment",
		Vars: map[string]interface{}{
			"name_prefix":                   "test-cost-optimization",
			"environment":                  "test",
			"s3_retention_days":            30, // Minimum retention
			"log_analytics_retention_days": 30,
			"enable_application_insights":  false, // Disable to save costs
			"enable_automation_rules":      false, // Minimal features
			"enable_sentinel":              false, // Use only Log Analytics
		},
	}

	terraform.Init(t, terraformOptions)
	plan := terraform.Plan(t, terraformOptions)

	// Verify cost optimization settings
	costOptimizations := []string{
		"s3_expiration_days = 30",
		"log_analytics_retention_days = 30",
		"log_analytics_sku = \"PerGB2018\"",
	}

	for _, optimization := range costOptimizations {
		assert.Contains(t, plan, optimization)
	}

	// Verify expensive features are disabled
	expensiveFeatures := []string{
		"azurerm_application_insights",
		"azurerm_sentinel_log_analytics_workspace_onboarding",
		"azurerm_sentinel_automation_rule",
	}

	for _, feature := range expensiveFeatures {
		assert.NotContains(t, plan, feature)
	}
}

// TestNetworkingValidation validates networking configurations
func TestNetworkingValidation(t *testing.T) {
	t.Parallel()

	terraformOptions := &terraform.Options{
		TerraformDir: "../examples/complete-deployment",
		Vars: map[string]interface{}{
			"name_prefix":       "test-networking",
			"environment":      "test",
			"dce_public_access": false, // Test private networking
		},
	}

	terraform.Init(t, terraformOptions)
	plan := terraform.Plan(t, terraformOptions)

	// Verify networking configurations
	networkingChecks := []string{
		"public_network_access_enabled = false",
		"block_public_acls = true",
		"block_public_policy = true",
		"ignore_public_acls = true",
		"restrict_public_buckets = true",
	}

	for _, check := range networkingChecks {
		assert.Contains(t, plan, check)
	}
}

// TestModuleDependencyValidation validates dependencies between modules
func TestModuleDependencyValidation(t *testing.T) {
	t.Parallel()

	terraformOptions := &terraform.Options{
		TerraformDir: "../examples/complete-deployment",
		Vars: map[string]interface{}{
			"name_prefix": "test-dependencies",
			"environment": "test",
		},
	}

	terraform.Init(t, terraformOptions)
	plan := terraform.Plan(t, terraformOptions)

	// Verify module dependencies
	assert.Contains(t, plan, "module.guardduty_aws")
	assert.Contains(t, plan, "module.guardduty_azure")
	assert.Contains(t, plan, "module.guardduty_sentinel")

	// Verify Sentinel module depends on Azure module
	assert.Contains(t, plan, "depends_on = [module.guardduty_azure]")
}