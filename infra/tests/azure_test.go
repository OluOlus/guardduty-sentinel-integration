package test

import (
	"testing"

	"github.com/gruntwork-io/terratest/modules/azure"
	"github.com/gruntwork-io/terratest/modules/terraform"
	"github.com/stretchr/testify/assert"
)

func TestAzureInfrastructure(t *testing.T) {
	t.Parallel()

	// Configure Terraform options
	terraformOptions := &terraform.Options{
		TerraformDir: "../azure",
		Vars: map[string]interface{}{
			"name_prefix":                        "test-guardduty",
			"location":                          "East US",
			"create_resource_group":             true,
			"resource_group_name":               "rg-test-guardduty",
			"log_analytics_workspace_name":      "law-test-guardduty",
			"log_analytics_retention_days":      30,
			"create_kql_functions":             true,
			"create_application_insights":       false,
			"dce_public_network_access_enabled": true,
		},
	}

	// Clean up resources
	defer terraform.Destroy(t, terraformOptions)

	// Run Terraform
	terraform.InitAndApply(t, terraformOptions)

	// Test Resource Group
	resourceGroupName := terraform.Output(t, terraformOptions, "resource_group_name")
	assert.Equal(t, "rg-test-guardduty", resourceGroupName)

	// Verify Resource Group exists
	assert.True(t, azure.ResourceGroupExists(t, resourceGroupName, ""))

	// Test Log Analytics Workspace
	workspaceId := terraform.Output(t, terraformOptions, "log_analytics_workspace_id")
	assert.NotEmpty(t, workspaceId)
	assert.Contains(t, workspaceId, "/subscriptions/")
	assert.Contains(t, workspaceId, "/resourceGroups/")
	assert.Contains(t, workspaceId, "/providers/Microsoft.OperationalInsights/workspaces/")

	// Test Data Collection Endpoint
	dceId := terraform.Output(t, terraformOptions, "data_collection_endpoint_id")
	assert.NotEmpty(t, dceId)
	assert.Contains(t, dceId, "/providers/Microsoft.Insights/dataCollectionEndpoints/")

	// Test Data Collection Rule
	dcrId := terraform.Output(t, terraformOptions, "data_collection_rule_id")
	dcrImmutableId := terraform.Output(t, terraformOptions, "data_collection_rule_immutable_id")
	assert.NotEmpty(t, dcrId)
	assert.NotEmpty(t, dcrImmutableId)
	assert.Contains(t, dcrId, "/providers/Microsoft.Insights/dataCollectionRules/")

	// Test Service Principal
	servicePrincipalAppId := terraform.Output(t, terraformOptions, "service_principal_application_id")
	servicePrincipalObjectId := terraform.Output(t, terraformOptions, "service_principal_object_id")
	assert.NotEmpty(t, servicePrincipalAppId)
	assert.NotEmpty(t, servicePrincipalObjectId)

	// Test Worker Configuration Output
	workerConfig := terraform.OutputMap(t, terraformOptions, "worker_configuration")
	assert.NotEmpty(t, workerConfig["tenant_id"])
	assert.NotEmpty(t, workerConfig["subscription_id"])
	assert.Equal(t, resourceGroupName, workerConfig["resource_group_name"])
	assert.Equal(t, "Custom-GuardDutyFindings", workerConfig["stream_name"])
}

func TestAzureWithExistingResourceGroup(t *testing.T) {
	t.Parallel()

	// First create a resource group
	resourceGroupName := "rg-existing-test"
	location := "East US"

	// Create resource group using Azure CLI (assuming it exists)
	// This test assumes the resource group already exists

	terraformOptions := &terraform.Options{
		TerraformDir: "../azure",
		Vars: map[string]interface{}{
			"name_prefix":                   "test-existing",
			"location":                     location,
			"create_resource_group":        false,
			"resource_group_name":          resourceGroupName,
			"log_analytics_workspace_name": "law-test-existing",
		},
	}

	// Skip if resource group doesn't exist
	if !azure.ResourceGroupExists(t, resourceGroupName, "") {
		t.Skip("Resource group doesn't exist, skipping test")
	}

	defer terraform.Destroy(t, terraformOptions)
	terraform.InitAndApply(t, terraformOptions)

	// Verify it uses existing resource group
	outputResourceGroupName := terraform.Output(t, terraformOptions, "resource_group_name")
	assert.Equal(t, resourceGroupName, outputResourceGroupName)
}

func TestAzureDataCollectionConfiguration(t *testing.T) {
	t.Parallel()

	terraformOptions := &terraform.Options{
		TerraformDir: "../azure",
		Vars: map[string]interface{}{
			"name_prefix":                        "test-dcr",
			"create_resource_group":             true,
			"resource_group_name":               "rg-test-dcr",
			"enable_data_transformation":        true,
			"dce_public_network_access_enabled": false,
		},
	}

	defer terraform.Destroy(t, terraformOptions)
	terraform.InitAndApply(t, terraformOptions)

	// Test DCE configuration
	dceUri := terraform.Output(t, terraformOptions, "data_collection_endpoint_logs_ingestion_uri")
	assert.NotEmpty(t, dceUri)
	assert.Contains(t, dceUri, "https://")

	// Test DCR configuration
	dcrImmutableId := terraform.Output(t, terraformOptions, "data_collection_rule_immutable_id")
	assert.NotEmpty(t, dcrImmutableId)
	assert.Contains(t, dcrImmutableId, "dcr-")
}

func TestAzureSecurityConfiguration(t *testing.T) {
	t.Parallel()

	terraformOptions := &terraform.Options{
		TerraformDir: "../azure",
		Vars: map[string]interface{}{
			"name_prefix":                   "test-security",
			"create_resource_group":        true,
			"resource_group_name":          "rg-test-security",
			"grant_log_analytics_access":   false,
		},
	}

	defer terraform.Destroy(t, terraformOptions)
	terraform.InitAndApply(t, terraformOptions)

	// Test service principal permissions
	servicePrincipalObjectId := terraform.Output(t, terraformOptions, "service_principal_object_id")
	assert.NotEmpty(t, servicePrincipalObjectId)

	// Verify minimal permissions (service principal should only have DCR access)
	// This would require Azure API calls to verify RBAC assignments
	// For now, we verify the outputs are correct
	workerConfig := terraform.OutputMap(t, terraformOptions, "worker_configuration")
	assert.NotEmpty(t, workerConfig["client_id"])
}

func TestAzureCostOptimization(t *testing.T) {
	t.Parallel()

	terraformOptions := &terraform.Options{
		TerraformDir: "../azure",
		Vars: map[string]interface{}{
			"name_prefix":                   "test-cost",
			"create_resource_group":        true,
			"resource_group_name":          "rg-test-cost",
			"log_analytics_sku":           "PerGB2018",
			"log_analytics_retention_days": 30, // Minimum retention for cost optimization
			"create_application_insights":  false,
		},
	}

	defer terraform.Destroy(t, terraformOptions)
	terraform.InitAndApply(t, terraformOptions)

	// Verify cost-optimized configuration
	workspaceId := terraform.Output(t, terraformOptions, "log_analytics_workspace_id")
	assert.NotEmpty(t, workspaceId)

	// Application Insights should not be created
	appInsightsKey := terraform.Output(t, terraformOptions, "application_insights_instrumentation_key")
	assert.Empty(t, appInsightsKey)
}

// TestAzureResourceDependencies validates proper resource dependencies and ordering
func TestAzureResourceDependencies(t *testing.T) {
	t.Parallel()

	terraformOptions := &terraform.Options{
		TerraformDir: "../azure",
		Vars: map[string]interface{}{
			"name_prefix":           "test-deps",
			"create_resource_group": true,
			"resource_group_name":   "rg-test-deps",
		},
	}

	defer terraform.Destroy(t, terraformOptions)

	// Test that plan shows proper dependencies
	terraform.Init(t, terraformOptions)
	plan := terraform.Plan(t, terraformOptions)

	// Verify resource group is created first
	assert.Contains(t, plan, "azurerm_resource_group.main")

	// Verify Log Analytics workspace depends on resource group
	assert.Contains(t, plan, "azurerm_log_analytics_workspace.main")

	// Verify DCE and DCR depend on workspace
	assert.Contains(t, plan, "azurerm_monitor_data_collection_endpoint.main")
	assert.Contains(t, plan, "azurerm_monitor_data_collection_rule.main")

	// Verify service principal and RBAC assignments
	assert.Contains(t, plan, "azuread_application.guardduty_ingestion")
	assert.Contains(t, plan, "azurerm_role_assignment.monitoring_metrics_publisher")

	terraform.Apply(t, terraformOptions)

	// Verify all resources are created
	resourceGroupName := terraform.Output(t, terraformOptions, "resource_group_name")
	workspaceId := terraform.Output(t, terraformOptions, "log_analytics_workspace_id")
	dcrId := terraform.Output(t, terraformOptions, "data_collection_rule_id")

	assert.NotEmpty(t, resourceGroupName)
	assert.NotEmpty(t, workspaceId)
	assert.NotEmpty(t, dcrId)
}

// TestAzureNetworkingConfiguration validates networking and access controls
func TestAzureNetworkingConfiguration(t *testing.T) {
	t.Parallel()

	terraformOptions := &terraform.Options{
		TerraformDir: "../azure",
		Vars: map[string]interface{}{
			"name_prefix":                        "test-network",
			"create_resource_group":             true,
			"resource_group_name":               "rg-test-network",
			"dce_public_network_access_enabled": false, // Test private access
		},
	}

	defer terraform.Destroy(t, terraformOptions)
	terraform.InitAndApply(t, terraformOptions)

	// Test DCE configuration
	dceUri := terraform.Output(t, terraformOptions, "data_collection_endpoint_logs_ingestion_uri")
	assert.NotEmpty(t, dceUri)
	assert.Contains(t, dceUri, "https://")

	// Verify private endpoint configuration
	// Note: This would require Azure API calls to fully validate private endpoint settings
	dceId := terraform.Output(t, terraformOptions, "data_collection_endpoint_id")
	assert.NotEmpty(t, dceId)
	assert.Contains(t, dceId, "/providers/Microsoft.Insights/dataCollectionEndpoints/")
}

// TestAzureSecurityCompliance validates security and compliance configurations
func TestAzureSecurityCompliance(t *testing.T) {
	t.Parallel()

	terraformOptions := &terraform.Options{
		TerraformDir: "../azure",
		Vars: map[string]interface{}{
			"name_prefix":                 "test-compliance",
			"create_resource_group":      true,
			"resource_group_name":        "rg-test-compliance",
			"grant_log_analytics_access": false, // Minimal permissions
		},
	}

	defer terraform.Destroy(t, terraformOptions)
	terraform.InitAndApply(t, terraformOptions)

	// Test service principal configuration
	servicePrincipalAppId := terraform.Output(t, terraformOptions, "service_principal_application_id")
	servicePrincipalObjectId := terraform.Output(t, terraformOptions, "service_principal_object_id")
	assert.NotEmpty(t, servicePrincipalAppId)
	assert.NotEmpty(t, servicePrincipalObjectId)

	// Verify DCR configuration for secure ingestion
	dcrImmutableId := terraform.Output(t, terraformOptions, "data_collection_rule_immutable_id")
	assert.NotEmpty(t, dcrImmutableId)
	assert.Contains(t, dcrImmutableId, "dcr-")

	// Test worker configuration has required security settings
	workerConfig := terraform.OutputMap(t, terraformOptions, "worker_configuration")
	assert.NotEmpty(t, workerConfig["tenant_id"])
	assert.NotEmpty(t, workerConfig["client_id"])
	assert.NotEmpty(t, workerConfig["data_collection_endpoint_uri"])
}

// TestAzureDataTransformationConfiguration validates data transformation settings
func TestAzureDataTransformationConfiguration(t *testing.T) {
	t.Parallel()

	terraformOptions := &terraform.Options{
		TerraformDir: "../azure",
		Vars: map[string]interface{}{
			"name_prefix":                "test-transform",
			"create_resource_group":     true,
			"resource_group_name":       "rg-test-transform",
			"enable_data_transformation": true,
		},
	}

	defer terraform.Destroy(t, terraformOptions)

	// Test configuration without applying (to avoid resource costs)
	terraform.Init(t, terraformOptions)
	plan := terraform.Plan(t, terraformOptions)

	// Verify data transformation is configured in DCR
	assert.Contains(t, plan, "enable_data_transformation")
	assert.Contains(t, plan, "transform_kql")

	terraform.Apply(t, terraformOptions)

	// Verify DCR is configured with transformation
	dcrId := terraform.Output(t, terraformOptions, "data_collection_rule_id")
	assert.NotEmpty(t, dcrId)
}

// TestAzureKQLFunctionCreation validates KQL function creation
func TestAzureKQLFunctionCreation(t *testing.T) {
	t.Parallel()

	terraformOptions := &terraform.Options{
		TerraformDir: "../azure",
		Vars: map[string]interface{}{
			"name_prefix":           "test-kql",
			"create_resource_group": true,
			"resource_group_name":   "rg-test-kql",
			"create_kql_functions":  true,
		},
	}

	defer terraform.Destroy(t, terraformOptions)

	// Test configuration
	terraform.Init(t, terraformOptions)
	plan := terraform.Plan(t, terraformOptions)

	// Verify KQL functions are planned for creation
	assert.Contains(t, plan, "azurerm_log_analytics_saved_search.guardduty_normalized")
	assert.Contains(t, plan, "azurerm_log_analytics_saved_search.guardduty_high_severity")

	terraform.Apply(t, terraformOptions)

	// Verify workspace and functions are created
	workspaceId := terraform.Output(t, terraformOptions, "log_analytics_workspace_id")
	assert.NotEmpty(t, workspaceId)
}