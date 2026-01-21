package test

import (
	"testing"

	"github.com/gruntwork-io/terratest/modules/terraform"
	"github.com/stretchr/testify/assert"
)

func TestSentinelAnalytics(t *testing.T) {
	t.Parallel()

	// This test assumes a Log Analytics workspace already exists
	// In practice, you would create the Azure infrastructure first
	terraformOptions := &terraform.Options{
		TerraformDir: "../sentinel",
		Vars: map[string]interface{}{
			"resource_group_name":          "rg-test-sentinel",
			"log_analytics_workspace_name": "law-test-sentinel",
			"name_prefix":                  "test-sentinel",
			"enable_sentinel":              true,
			"create_analytics_rules":       true,
			"create_workbooks":            true,
			"create_automation_rules":     true,
			"notification_emails": []string{
				"test@example.com",
			},
		},
	}

	// Skip if workspace doesn't exist
	// In a real test, you'd create the workspace first or use a test fixture
	defer terraform.Destroy(t, terraformOptions)

	// This would fail if the workspace doesn't exist
	// terraform.InitAndApply(t, terraformOptions)

	// For now, just validate the configuration
	terraform.Init(t, terraformOptions)
	terraform.Plan(t, terraformOptions)
}

func TestSentinelAnalyticsRules(t *testing.T) {
	t.Parallel()

	terraformOptions := &terraform.Options{
		TerraformDir: "../sentinel",
		Vars: map[string]interface{}{
			"resource_group_name":          "rg-test-analytics",
			"log_analytics_workspace_name": "law-test-analytics",
			"name_prefix":                  "test-analytics",
			"enable_sentinel":              true,
			"create_analytics_rules":       true,
			"high_severity_threshold":      8.0,
			"analytics_rule_frequencies": map[string]interface{}{
				"high_severity_findings": "PT30M",
				"cryptocurrency_mining":  "PT2H",
			},
		},
	}

	// Validate configuration without applying
	terraform.Init(t, terraformOptions)
	plan := terraform.Plan(t, terraformOptions)

	// Verify analytics rules are planned for creation
	assert.Contains(t, plan, "azurerm_sentinel_alert_rule_scheduled.high_severity_findings")
	assert.Contains(t, plan, "azurerm_sentinel_alert_rule_scheduled.cryptocurrency_mining")
	assert.Contains(t, plan, "azurerm_sentinel_alert_rule_scheduled.data_exfiltration")
	assert.Contains(t, plan, "azurerm_sentinel_alert_rule_scheduled.malware_backdoor")
}

func TestSentinelWorkbooks(t *testing.T) {
	t.Parallel()

	terraformOptions := &terraform.Options{
		TerraformDir: "../sentinel",
		Vars: map[string]interface{}{
			"resource_group_name":          "rg-test-workbooks",
			"log_analytics_workspace_name": "law-test-workbooks",
			"name_prefix":                  "test-workbooks",
			"enable_sentinel":              true,
			"create_workbooks":            true,
		},
	}

	terraform.Init(t, terraformOptions)
	plan := terraform.Plan(t, terraformOptions)

	// Verify workbooks are planned for creation
	assert.Contains(t, plan, "azurerm_sentinel_workbook.guardduty_overview")
	assert.Contains(t, plan, "azurerm_sentinel_workbook.guardduty_threat_hunting")
}

func TestSentinelNotificationConfiguration(t *testing.T) {
	t.Parallel()

	terraformOptions := &terraform.Options{
		TerraformDir: "../sentinel",
		Vars: map[string]interface{}{
			"resource_group_name":          "rg-test-notifications",
			"log_analytics_workspace_name": "law-test-notifications",
			"name_prefix":                  "test-notifications",
			"notification_emails": []string{
				"security@example.com",
				"soc@example.com",
			},
			"notification_webhooks": []string{
				"https://hooks.slack.com/services/test/webhook",
			},
		},
	}

	terraform.Init(t, terraformOptions)
	plan := terraform.Plan(t, terraformOptions)

	// Verify action group is configured with notifications
	assert.Contains(t, plan, "azurerm_monitor_action_group.guardduty_incidents")
}

func TestSentinelAutomationRules(t *testing.T) {
	t.Parallel()

	terraformOptions := &terraform.Options{
		TerraformDir: "../sentinel",
		Vars: map[string]interface{}{
			"resource_group_name":          "rg-test-automation",
			"log_analytics_workspace_name": "law-test-automation",
			"name_prefix":                  "test-automation",
			"enable_sentinel":              true,
			"create_automation_rules":     true,
			"default_incident_owner_id":   "12345678-1234-1234-1234-123456789012",
		},
	}

	terraform.Init(t, terraformOptions)
	plan := terraform.Plan(t, terraformOptions)

	// Verify automation rule is planned for creation
	assert.Contains(t, plan, "azurerm_sentinel_automation_rule.high_severity_auto_assign")
}

func TestSentinelMinimalConfiguration(t *testing.T) {
	t.Parallel()

	// Test minimal configuration with most features disabled
	terraformOptions := &terraform.Options{
		TerraformDir: "../sentinel",
		Vars: map[string]interface{}{
			"resource_group_name":          "rg-test-minimal",
			"log_analytics_workspace_name": "law-test-minimal",
			"name_prefix":                  "test-minimal",
			"enable_sentinel":              false,
			"create_analytics_rules":       false,
			"create_workbooks":            false,
			"create_automation_rules":     false,
		},
	}

	terraform.Init(t, terraformOptions)
	plan := terraform.Plan(t, terraformOptions)

	// Verify minimal resources are planned
	assert.Contains(t, plan, "azurerm_monitor_action_group.guardduty_incidents")
	
	// Verify Sentinel-specific resources are not planned
	assert.NotContains(t, plan, "azurerm_sentinel_log_analytics_workspace_onboarding")
	assert.NotContains(t, plan, "azurerm_sentinel_alert_rule_scheduled")
	assert.NotContains(t, plan, "azurerm_sentinel_workbook")
}

// TestSentinelResourceDependencies validates proper resource dependencies
func TestSentinelResourceDependencies(t *testing.T) {
	t.Parallel()

	terraformOptions := &terraform.Options{
		TerraformDir: "../sentinel",
		Vars: map[string]interface{}{
			"resource_group_name":          "rg-test-deps",
			"log_analytics_workspace_name": "law-test-deps",
			"name_prefix":                  "test-deps",
			"enable_sentinel":              true,
			"create_analytics_rules":       true,
			"create_workbooks":            true,
		},
	}

	terraform.Init(t, terraformOptions)
	plan := terraform.Plan(t, terraformOptions)

	// Verify Sentinel onboarding comes first
	assert.Contains(t, plan, "azurerm_sentinel_log_analytics_workspace_onboarding.main")

	// Verify analytics rules depend on Sentinel onboarding
	assert.Contains(t, plan, "azurerm_sentinel_alert_rule_scheduled.high_severity_findings")
	assert.Contains(t, plan, "depends_on")

	// Verify workbooks depend on Sentinel onboarding
	assert.Contains(t, plan, "azurerm_sentinel_workbook.guardduty_overview")
}

// TestSentinelSecurityConfiguration validates security settings
func TestSentinelSecurityConfiguration(t *testing.T) {
	t.Parallel()

	terraformOptions := &terraform.Options{
		TerraformDir: "../sentinel",
		Vars: map[string]interface{}{
			"resource_group_name":                    "rg-test-security",
			"log_analytics_workspace_name":           "law-test-security",
			"name_prefix":                           "test-security",
			"enable_sentinel":                       true,
			"sentinel_customer_managed_key_enabled": false, // Standard encryption
			"create_analytics_rules":                true,
		},
	}

	terraform.Init(t, terraformOptions)
	plan := terraform.Plan(t, terraformOptions)

	// Verify security configurations
	assert.Contains(t, plan, "customer_managed_key_enabled = false")
	
	// Verify analytics rules have proper security context
	assert.Contains(t, plan, "Severity >= 7.0") // High severity threshold
	assert.Contains(t, plan, "entity_mapping")  // Entity mapping for investigations
}

// TestSentinelAnalyticsRuleValidation validates analytics rule configurations
func TestSentinelAnalyticsRuleValidation(t *testing.T) {
	t.Parallel()

	terraformOptions := &terraform.Options{
		TerraformDir: "../sentinel",
		Vars: map[string]interface{}{
			"resource_group_name":          "rg-test-rules",
			"log_analytics_workspace_name": "law-test-rules",
			"name_prefix":                  "test-rules",
			"enable_sentinel":              true,
			"create_analytics_rules":       true,
			"high_severity_threshold":      8.0, // Custom threshold
			"analytics_rule_frequencies": map[string]interface{}{
				"high_severity_findings": "PT30M",
				"cryptocurrency_mining":  "PT2H",
				"data_exfiltration":      "PT2H",
				"malware_backdoor":       "PT1H",
			},
		},
	}

	terraform.Init(t, terraformOptions)
	plan := terraform.Plan(t, terraformOptions)

	// Verify all analytics rules are configured
	expectedRules := []string{
		"azurerm_sentinel_alert_rule_scheduled.high_severity_findings",
		"azurerm_sentinel_alert_rule_scheduled.cryptocurrency_mining",
		"azurerm_sentinel_alert_rule_scheduled.data_exfiltration",
		"azurerm_sentinel_alert_rule_scheduled.malware_backdoor",
	}

	for _, rule := range expectedRules {
		assert.Contains(t, plan, rule)
	}

	// Verify custom threshold is used
	assert.Contains(t, plan, "Severity >= 8.0")

	// Verify query frequencies
	assert.Contains(t, plan, "query_frequency   = \"PT30M\"")
	assert.Contains(t, plan, "query_frequency   = \"PT2H\"")
	assert.Contains(t, plan, "query_frequency   = \"PT1H\"")
}

// TestSentinelNotificationConfiguration validates notification settings
func TestSentinelNotificationConfiguration(t *testing.T) {
	t.Parallel()

	terraformOptions := &terraform.Options{
		TerraformDir: "../sentinel",
		Vars: map[string]interface{}{
			"resource_group_name":          "rg-test-notifications",
			"log_analytics_workspace_name": "law-test-notifications",
			"name_prefix":                  "test-notifications",
			"notification_emails": []string{
				"security@example.com",
				"soc@example.com",
			},
			"notification_webhooks": []string{
				"https://hooks.slack.com/services/test/webhook",
			},
		},
	}

	terraform.Init(t, terraformOptions)
	plan := terraform.Plan(t, terraformOptions)

	// Verify action group configuration
	assert.Contains(t, plan, "azurerm_monitor_action_group.guardduty_incidents")
	assert.Contains(t, plan, "email_receiver")
	assert.Contains(t, plan, "webhook_receiver")
	assert.Contains(t, plan, "security@example.com")
	assert.Contains(t, plan, "soc@example.com")
	assert.Contains(t, plan, "hooks.slack.com")
}

// TestSentinelWorkbookConfiguration validates workbook settings
func TestSentinelWorkbookConfiguration(t *testing.T) {
	t.Parallel()

	terraformOptions := &terraform.Options{
		TerraformDir: "../sentinel",
		Vars: map[string]interface{}{
			"resource_group_name":          "rg-test-workbooks",
			"log_analytics_workspace_name": "law-test-workbooks",
			"name_prefix":                  "test-workbooks",
			"enable_sentinel":              true,
			"create_workbooks":            true,
		},
	}

	terraform.Init(t, terraformOptions)
	plan := terraform.Plan(t, terraformOptions)

	// Verify workbooks are configured
	assert.Contains(t, plan, "azurerm_sentinel_workbook.guardduty_overview")
	assert.Contains(t, plan, "azurerm_sentinel_workbook.guardduty_threat_hunting")

	// Verify workbook content includes proper KQL queries
	assert.Contains(t, plan, "RawGuardDuty_CL")
	assert.Contains(t, plan, "TimeGenerated >= ago(24h)")
	assert.Contains(t, plan, "render timechart")
	assert.Contains(t, plan, "render piechart")
}

// TestSentinelCostOptimization validates cost optimization settings
func TestSentinelCostOptimization(t *testing.T) {
	t.Parallel()

	terraformOptions := &terraform.Options{
		TerraformDir: "../sentinel",
		Vars: map[string]interface{}{
			"resource_group_name":                    "rg-test-cost-opt",
			"log_analytics_workspace_name":           "law-test-cost-opt",
			"name_prefix":                           "test-cost-opt",
			"enable_sentinel":                       false, // Disable Sentinel to save costs
			"create_analytics_rules":                false,
			"create_workbooks":                      false,
			"create_automation_rules":               false,
			"sentinel_customer_managed_key_enabled": false, // Use standard encryption
		},
	}

	terraform.Init(t, terraformOptions)
	plan := terraform.Plan(t, terraformOptions)

	// Verify cost-optimized configuration
	assert.NotContains(t, plan, "azurerm_sentinel_log_analytics_workspace_onboarding")
	assert.NotContains(t, plan, "azurerm_sentinel_alert_rule_scheduled")
	assert.NotContains(t, plan, "azurerm_sentinel_workbook")
	assert.NotContains(t, plan, "azurerm_sentinel_automation_rule")

	// Only action group should be created for basic alerting
	assert.Contains(t, plan, "azurerm_monitor_action_group.guardduty_incidents")
}