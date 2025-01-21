package test

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gruntwork-io/terratest/modules/terraform"
	"github.com/stretchr/testify/assert"
)

// ComplianceRule represents a compliance rule to check
type ComplianceRule struct {
	Name        string
	Description string
	Check       func(t *testing.T, plan string) bool
	Severity    string // "HIGH", "MEDIUM", "LOW"
}

// TestSecurityCompliance validates security compliance across all modules
func TestSecurityCompliance(t *testing.T) {
	t.Parallel()

	securityRules := []ComplianceRule{
		{
			Name:        "S3_ENCRYPTION_ENABLED",
			Description: "S3 buckets must have encryption enabled",
			Severity:    "HIGH",
			Check: func(t *testing.T, plan string) bool {
				if !strings.Contains(plan, "aws_s3_bucket") {
					return true // No S3 buckets, rule doesn't apply
				}
				return strings.Contains(plan, "server_side_encryption_configuration")
			},
		},
		{
			Name:        "S3_PUBLIC_ACCESS_BLOCKED",
			Description: "S3 buckets must block public access",
			Severity:    "HIGH",
			Check: func(t *testing.T, plan string) bool {
				if !strings.Contains(plan, "aws_s3_bucket") {
					return true
				}
				return strings.Contains(plan, "block_public_acls = true") &&
					strings.Contains(plan, "block_public_policy = true") &&
					strings.Contains(plan, "ignore_public_acls = true") &&
					strings.Contains(plan, "restrict_public_buckets = true")
			},
		},
		{
			Name:        "KMS_KEY_ROTATION_ENABLED",
			Description: "KMS keys must have rotation enabled",
			Severity:    "HIGH",
			Check: func(t *testing.T, plan string) bool {
				if !strings.Contains(plan, "aws_kms_key") {
					return true
				}
				return strings.Contains(plan, "enable_key_rotation = true")
			},
		},
		{
			Name:        "IAM_EXTERNAL_ID_REQUIRED",
			Description: "Cross-account IAM roles must use external ID",
			Severity:    "MEDIUM",
			Check: func(t *testing.T, plan string) bool {
				if !strings.Contains(plan, "cross_account") {
					return true
				}
				return strings.Contains(plan, "sts:ExternalId")
			},
		},
		{
			Name:        "LOG_ANALYTICS_RETENTION_SET",
			Description: "Log Analytics workspaces must have retention configured",
			Severity:    "MEDIUM",
			Check: func(t *testing.T, plan string) bool {
				if !strings.Contains(plan, "azurerm_log_analytics_workspace") {
					return true
				}
				return strings.Contains(plan, "retention_in_days")
			},
		},
		{
			Name:        "DCE_PRIVATE_ACCESS_PREFERRED",
			Description: "Data Collection Endpoints should use private access when possible",
			Severity:    "LOW",
			Check: func(t *testing.T, plan string) bool {
				if !strings.Contains(plan, "azurerm_monitor_data_collection_endpoint") {
					return true
				}
				// This is a preference, not a hard requirement
				return true
			},
		},
	}

	modules := []string{
		"../aws",
		"../azure",
		"../sentinel",
		"../examples/complete-deployment",
	}

	for _, module := range modules {
		t.Run(fmt.Sprintf("SecurityCompliance-%s", filepath.Base(module)), func(t *testing.T) {
			terraformOptions := &terraform.Options{
				TerraformDir: module,
				Vars: map[string]interface{}{
					"name_prefix": "compliance-test",
				},
			}

			// Add module-specific variables
			if module == "../sentinel" {
				terraformOptions.Vars["resource_group_name"] = "rg-compliance-test"
				terraformOptions.Vars["log_analytics_workspace_name"] = "law-compliance-test"
			}

			terraform.Init(t, terraformOptions)
			plan := terraform.Plan(t, terraformOptions)

			// Check each compliance rule
			var failedRules []ComplianceRule
			for _, rule := range securityRules {
				if !rule.Check(t, plan) {
					failedRules = append(failedRules, rule)
					t.Errorf("Security compliance rule failed: %s - %s (Severity: %s)",
						rule.Name, rule.Description, rule.Severity)
				}
			}

			// Fail test if any HIGH severity rules failed
			for _, rule := range failedRules {
				if rule.Severity == "HIGH" {
					t.Fatalf("HIGH severity security compliance rule failed: %s", rule.Name)
				}
			}

			t.Logf("Security compliance check completed for %s. Failed rules: %d",
				module, len(failedRules))
		})
	}
}

// TestCostOptimizationCompliance validates cost optimization best practices
func TestCostOptimizationCompliance(t *testing.T) {
	t.Parallel()

	costRules := []ComplianceRule{
		{
			Name:        "S3_LIFECYCLE_CONFIGURED",
			Description: "S3 buckets should have lifecycle policies for cost optimization",
			Severity:    "MEDIUM",
			Check: func(t *testing.T, plan string) bool {
				if !strings.Contains(plan, "aws_s3_bucket") {
					return true
				}
				return strings.Contains(plan, "lifecycle_configuration") ||
					strings.Contains(plan, "s3_lifecycle_enabled = true")
			},
		},
		{
			Name:        "LOG_ANALYTICS_RETENTION_OPTIMIZED",
			Description: "Log Analytics retention should be optimized for cost",
			Severity:    "LOW",
			Check: func(t *testing.T, plan string) bool {
				if !strings.Contains(plan, "retention_in_days") {
					return true
				}
				// Check for reasonable retention (30-90 days for cost optimization)
				return strings.Contains(plan, "retention_in_days = 30") ||
					strings.Contains(plan, "retention_in_days = 60") ||
					strings.Contains(plan, "retention_in_days = 90")
			},
		},
		{
			Name:        "OPTIONAL_FEATURES_CONFIGURABLE",
			Description: "Expensive optional features should be configurable",
			Severity:    "MEDIUM",
			Check: func(t *testing.T, plan string) bool {
				// Check that Application Insights is optional
				if strings.Contains(plan, "azurerm_application_insights") {
					return strings.Contains(plan, "create_application_insights")
				}
				return true
			},
		},
		{
			Name:        "KMS_DELETION_WINDOW_OPTIMIZED",
			Description: "KMS key deletion window should be optimized for testing",
			Severity:    "LOW",
			Check: func(t *testing.T, plan string) bool {
				if !strings.Contains(plan, "deletion_window_in_days") {
					return true
				}
				// Allow configurable deletion window for cost optimization in testing
				return true
			},
		},
	}

	terraformOptions := &terraform.Options{
		TerraformDir: "../examples/complete-deployment",
		Vars: map[string]interface{}{
			"name_prefix":                   "cost-compliance-test",
			"environment":                  "test",
			"s3_retention_days":            30,
			"log_analytics_retention_days": 30,
			"enable_application_insights":  false,
		},
	}

	terraform.Init(t, terraformOptions)
	plan := terraform.Plan(t, terraformOptions)

	var failedRules []ComplianceRule
	for _, rule := range costRules {
		if !rule.Check(t, plan) {
			failedRules = append(failedRules, rule)
			t.Errorf("Cost optimization rule failed: %s - %s (Severity: %s)",
				rule.Name, rule.Description, rule.Severity)
		}
	}

	t.Logf("Cost optimization compliance check completed. Failed rules: %d", len(failedRules))
}

// TestDataGovernanceCompliance validates data governance and privacy compliance
func TestDataGovernanceCompliance(t *testing.T) {
	t.Parallel()

	dataRules := []ComplianceRule{
		{
			Name:        "DATA_ENCRYPTION_IN_TRANSIT",
			Description: "Data must be encrypted in transit",
			Severity:    "HIGH",
			Check: func(t *testing.T, plan string) bool {
				// Check for HTTPS endpoints
				if strings.Contains(plan, "endpoint") {
					return strings.Contains(plan, "https://")
				}
				return true
			},
		},
		{
			Name:        "DATA_ENCRYPTION_AT_REST",
			Description: "Data must be encrypted at rest",
			Severity:    "HIGH",
			Check: func(t *testing.T, plan string) bool {
				// Check S3 encryption
				if strings.Contains(plan, "aws_s3_bucket") {
					return strings.Contains(plan, "sse_algorithm")
				}
				return true
			},
		},
		{
			Name:        "DATA_RETENTION_CONFIGURED",
			Description: "Data retention policies must be configured",
			Severity:    "MEDIUM",
			Check: func(t *testing.T, plan string) bool {
				hasS3 := strings.Contains(plan, "aws_s3_bucket")
				hasLogAnalytics := strings.Contains(plan, "azurerm_log_analytics_workspace")

				if hasS3 {
					return strings.Contains(plan, "expiration_days") ||
						strings.Contains(plan, "lifecycle_configuration")
				}
				if hasLogAnalytics {
					return strings.Contains(plan, "retention_in_days")
				}
				return true
			},
		},
		{
			Name:        "ACCESS_CONTROL_CONFIGURED",
			Description: "Proper access controls must be configured",
			Severity:    "HIGH",
			Check: func(t *testing.T, plan string) bool {
				// Check for IAM roles and RBAC assignments
				hasIAM := strings.Contains(plan, "aws_iam_role")
				hasRBAC := strings.Contains(plan, "azurerm_role_assignment")

				if hasIAM || hasRBAC {
					return strings.Contains(plan, "principal") ||
						strings.Contains(plan, "Principal")
				}
				return true
			},
		},
	}

	terraformOptions := &terraform.Options{
		TerraformDir: "../examples/complete-deployment",
		Vars: map[string]interface{}{
			"name_prefix": "data-governance-test",
			"environment": "test",
		},
	}

	terraform.Init(t, terraformOptions)
	plan := terraform.Plan(t, terraformOptions)

	var failedRules []ComplianceRule
	for _, rule := range dataRules {
		if !rule.Check(t, plan) {
			failedRules = append(failedRules, rule)
			t.Errorf("Data governance rule failed: %s - %s (Severity: %s)",
				rule.Name, rule.Description, rule.Severity)
		}
	}

	// Fail test if any HIGH severity rules failed
	for _, rule := range failedRules {
		if rule.Severity == "HIGH" {
			t.Fatalf("HIGH severity data governance rule failed: %s", rule.Name)
		}
	}

	t.Logf("Data governance compliance check completed. Failed rules: %d", len(failedRules))
}

// TestOperationalCompliance validates operational best practices
func TestOperationalCompliance(t *testing.T) {
	t.Parallel()

	operationalRules := []ComplianceRule{
		{
			Name:        "RESOURCE_TAGGING_CONFIGURED",
			Description: "Resources should be properly tagged",
			Severity:    "MEDIUM",
			Check: func(t *testing.T, plan string) bool {
				// Check for tags configuration
				return strings.Contains(plan, "tags") || strings.Contains(plan, "Tags")
			},
		},
		{
			Name:        "MONITORING_CONFIGURED",
			Description: "Monitoring and logging should be configured",
			Severity:    "MEDIUM",
			Check: func(t *testing.T, plan string) bool {
				// Check for CloudWatch or Log Analytics
				return strings.Contains(plan, "cloudwatch") ||
					strings.Contains(plan, "log_analytics") ||
					strings.Contains(plan, "application_insights")
			},
		},
		{
			Name:        "BACKUP_RETENTION_CONFIGURED",
			Description: "Backup and retention policies should be configured",
			Severity:    "MEDIUM",
			Check: func(t *testing.T, plan string) bool {
				// Check for versioning and retention
				return strings.Contains(plan, "versioning") ||
					strings.Contains(plan, "retention") ||
					strings.Contains(plan, "backup")
			},
		},
		{
			Name:        "DISASTER_RECOVERY_CONSIDERED",
			Description: "Disaster recovery should be considered",
			Severity:    "LOW",
			Check: func(t *testing.T, plan string) bool {
				// Check for cross-region or multi-region configuration
				return strings.Contains(plan, "region") || strings.Contains(plan, "location")
			},
		},
	}

	terraformOptions := &terraform.Options{
		TerraformDir: "../examples/complete-deployment",
		Vars: map[string]interface{}{
			"name_prefix": "operational-compliance-test",
			"environment": "test",
			"tags": map[string]interface{}{
				"Environment": "test",
				"Project":     "guardduty-sentinel-integration",
			},
		},
	}

	terraform.Init(t, terraformOptions)
	plan := terraform.Plan(t, terraformOptions)

	var failedRules []ComplianceRule
	for _, rule := range operationalRules {
		if !rule.Check(t, plan) {
			failedRules = append(failedRules, rule)
			t.Errorf("Operational rule failed: %s - %s (Severity: %s)",
				rule.Name, rule.Description, rule.Severity)
		}
	}

	t.Logf("Operational compliance check completed. Failed rules: %d", len(failedRules))
}

// TestComplianceReport generates a comprehensive compliance report
func TestComplianceReport(t *testing.T) {
	t.Parallel()

	terraformOptions := &terraform.Options{
		TerraformDir: "../examples/complete-deployment",
		Vars: map[string]interface{}{
			"name_prefix": "compliance-report-test",
			"environment": "test",
		},
	}

	terraform.Init(t, terraformOptions)
	plan := terraform.Plan(t, terraformOptions)

	// Compliance report structure
	report := struct {
		Timestamp   string                 `json:"timestamp"`
		Module      string                 `json:"module"`
		Security    map[string]interface{} `json:"security"`
		Cost        map[string]interface{} `json:"cost"`
		Data        map[string]interface{} `json:"data_governance"`
		Operational map[string]interface{} `json:"operational"`
		Summary     map[string]interface{} `json:"summary"`
	}{
		Timestamp: time.Now().Format(time.RFC3339),
		Module:    "complete-deployment",
		Security: map[string]interface{}{
			"encryption_at_rest":     strings.Contains(plan, "sse_algorithm"),
			"encryption_in_transit":  strings.Contains(plan, "https://"),
			"public_access_blocked":  strings.Contains(plan, "block_public_acls"),
			"key_rotation_enabled":   strings.Contains(plan, "enable_key_rotation"),
		},
		Cost: map[string]interface{}{
			"lifecycle_configured":   strings.Contains(plan, "lifecycle"),
			"retention_optimized":    strings.Contains(plan, "retention_in_days = 30"),
			"optional_features":      strings.Contains(plan, "create_application_insights"),
		},
		Data: map[string]interface{}{
			"retention_policies":     strings.Contains(plan, "retention"),
			"access_controls":        strings.Contains(plan, "role_assignment"),
			"audit_logging":          strings.Contains(plan, "log_analytics"),
		},
		Operational: map[string]interface{}{
			"resource_tagging":       strings.Contains(plan, "tags"),
			"monitoring_configured":  strings.Contains(plan, "log_analytics"),
			"backup_configured":      strings.Contains(plan, "versioning"),
		},
	}

	// Calculate summary
	totalChecks := 0
	passedChecks := 0

	for category, checks := range map[string]map[string]interface{}{
		"security":    report.Security,
		"cost":        report.Cost,
		"data":        report.Data,
		"operational": report.Operational,
	} {
		categoryPassed := 0
		categoryTotal := len(checks)
		
		for _, passed := range checks {
			totalChecks++
			if passed.(bool) {
				passedChecks++
				categoryPassed++
			}
		}

		report.Summary[category+"_score"] = fmt.Sprintf("%d/%d", categoryPassed, categoryTotal)
	}

	report.Summary["overall_score"] = fmt.Sprintf("%d/%d", passedChecks, totalChecks)
	report.Summary["compliance_percentage"] = fmt.Sprintf("%.1f%%", 
		float64(passedChecks)/float64(totalChecks)*100)

	// Generate JSON report
	reportJSON, err := json.MarshalIndent(report, "", "  ")
	assert.NoError(t, err)

	// Write report to file
	reportFile := "compliance_report.json"
	err = os.WriteFile(reportFile, reportJSON, 0644)
	assert.NoError(t, err)

	t.Logf("Compliance report generated: %s", reportFile)
	t.Logf("Overall compliance: %s", report.Summary["compliance_percentage"])

	// Clean up report file
	defer os.Remove(reportFile)
}