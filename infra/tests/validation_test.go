package test

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gruntwork-io/terratest/modules/terraform"
	"github.com/stretchr/testify/assert"
)

// TestTerraformSyntaxValidation validates Terraform syntax across all modules
func TestTerraformSyntaxValidation(t *testing.T) {
	t.Parallel()

	modules := []string{
		"../aws",
		"../azure", 
		"../sentinel",
		"../examples/complete-deployment",
	}

	for _, module := range modules {
		t.Run(fmt.Sprintf("Validate-%s", filepath.Base(module)), func(t *testing.T) {
			terraformOptions := &terraform.Options{
				TerraformDir: module,
			}

			// Test Terraform init
			terraform.Init(t, terraformOptions)

			// Test Terraform validate
			terraform.Validate(t, terraformOptions)

			// Test Terraform format check
			terraform.Format(t, terraformOptions)
		})
	}
}

// TestTerraformSecurityScan validates security configurations using static analysis
func TestTerraformSecurityScan(t *testing.T) {
	t.Parallel()

	modules := []string{
		"../aws",
		"../azure",
		"../sentinel",
		"../examples/complete-deployment",
	}

	for _, module := range modules {
		t.Run(fmt.Sprintf("SecurityScan-%s", filepath.Base(module)), func(t *testing.T) {
			// Read all .tf files in the module
			files, err := filepath.Glob(filepath.Join(module, "*.tf"))
			assert.NoError(t, err)
			assert.NotEmpty(t, files, "No Terraform files found in %s", module)

			for _, file := range files {
				content, err := os.ReadFile(file)
				assert.NoError(t, err)

				fileContent := string(content)

				// Security checks
				t.Run(fmt.Sprintf("SecurityChecks-%s", filepath.Base(file)), func(t *testing.T) {
					// Check for hardcoded secrets (basic patterns)
					secretPatterns := []string{
						"password.*=.*\"[^\"]+\"",
						"secret.*=.*\"[^\"]+\"",
						"key.*=.*\"[^\"]+\"",
					}

					for _, pattern := range secretPatterns {
						assert.NotRegexp(t, pattern, fileContent, 
							"Potential hardcoded secret found in %s", file)
					}

					// Check for proper encryption configurations
					if strings.Contains(file, "aws") {
						if strings.Contains(fileContent, "aws_s3_bucket") {
							assert.Contains(t, fileContent, "server_side_encryption_configuration",
								"S3 bucket should have encryption configured in %s", file)
						}
						if strings.Contains(fileContent, "aws_kms_key") {
							assert.Contains(t, fileContent, "enable_key_rotation = true",
								"KMS key should have rotation enabled in %s", file)
						}
					}

					if strings.Contains(file, "azure") {
						// Azure-specific security checks
						if strings.Contains(fileContent, "azurerm_log_analytics_workspace") {
							// Check for proper retention settings
							assert.Contains(t, fileContent, "retention_in_days",
								"Log Analytics workspace should have retention configured in %s", file)
						}
					}
				})
			}
		})
	}
}

// TestTerraformResourceNaming validates resource naming conventions
func TestTerraformResourceNaming(t *testing.T) {
	t.Parallel()

	terraformOptions := &terraform.Options{
		TerraformDir: "../examples/complete-deployment",
		Vars: map[string]interface{}{
			"name_prefix": "test-naming-validation",
			"environment": "test",
		},
	}

	terraform.Init(t, terraformOptions)
	plan := terraform.Plan(t, terraformOptions)

	// Validate naming conventions
	namingTests := []struct {
		resource string
		pattern  string
	}{
		{"S3 Bucket", "test-naming-validation-guardduty-findings-test"},
		{"Resource Group", "test-naming-validation-rg-test"},
		{"Log Analytics", "test-naming-validation-law-test"},
		{"DCE", "test-naming-validation-dce"},
		{"DCR", "test-naming-validation-dcr"},
		{"KMS Key Alias", "alias/test-naming-validation-guardduty-s3"},
	}

	for _, test := range namingTests {
		t.Run(test.resource, func(t *testing.T) {
			assert.Contains(t, plan, test.pattern,
				"Resource %s should follow naming convention", test.resource)
		})
	}
}

// TestTerraformVariableValidation validates variable constraints and defaults
func TestTerraformVariableValidation(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name     string
		module   string
		vars     map[string]interface{}
		shouldFail bool
		errorMsg string
	}{
		{
			name:   "Valid AWS Configuration",
			module: "../aws",
			vars: map[string]interface{}{
				"name_prefix":        "valid-test",
				"s3_expiration_days": 30,
			},
			shouldFail: false,
		},
		{
			name:   "Invalid S3 Expiration Days",
			module: "../aws", 
			vars: map[string]interface{}{
				"name_prefix":        "invalid-test",
				"s3_expiration_days": 0, // Invalid: should be > 0
			},
			shouldFail: true,
			errorMsg:   "expiration_days must be greater than 0",
		},
		{
			name:   "Valid Azure Configuration",
			module: "../azure",
			vars: map[string]interface{}{
				"name_prefix":                   "valid-azure-test",
				"log_analytics_retention_days": 30,
			},
			shouldFail: false,
		},
		{
			name:   "Invalid Log Analytics Retention",
			module: "../azure",
			vars: map[string]interface{}{
				"name_prefix":                   "invalid-azure-test",
				"log_analytics_retention_days": 15, // Invalid: below minimum
			},
			shouldFail: true,
			errorMsg:   "retention must be between 30 and 730 days",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			terraformOptions := &terraform.Options{
				TerraformDir: tc.module,
				Vars:         tc.vars,
			}

			terraform.Init(t, terraformOptions)

			if tc.shouldFail {
				_, err := terraform.PlanE(t, terraformOptions)
				assert.Error(t, err)
				if tc.errorMsg != "" {
					assert.Contains(t, err.Error(), tc.errorMsg)
				}
			} else {
				terraform.Plan(t, terraformOptions)
			}
		})
	}
}

// TestTerraformOutputValidation validates that all required outputs are defined
func TestTerraformOutputValidation(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		module          string
		requiredOutputs []string
	}{
		{
			module: "../aws",
			requiredOutputs: []string{
				"s3_bucket_name",
				"s3_bucket_arn", 
				"kms_key_arn",
				"kms_key_id",
				"guardduty_detector_id",
				"publishing_destination_arn",
				"ingestion_role_arn",
			},
		},
		{
			module: "../azure",
			requiredOutputs: []string{
				"resource_group_name",
				"log_analytics_workspace_id",
				"log_analytics_workspace_name",
				"data_collection_endpoint_id",
				"data_collection_endpoint_logs_ingestion_uri",
				"data_collection_rule_id",
				"data_collection_rule_immutable_id",
				"service_principal_application_id",
				"service_principal_object_id",
				"worker_configuration",
			},
		},
		{
			module: "../sentinel",
			requiredOutputs: []string{
				"action_group_id",
				"sentinel_workspace_id",
			},
		},
	}

	for _, tc := range testCases {
		t.Run(fmt.Sprintf("Outputs-%s", filepath.Base(tc.module)), func(t *testing.T) {
			// Read outputs.tf file
			outputsFile := filepath.Join(tc.module, "outputs.tf")
			content, err := os.ReadFile(outputsFile)
			assert.NoError(t, err, "outputs.tf should exist in %s", tc.module)

			outputsContent := string(content)

			// Check that all required outputs are defined
			for _, output := range tc.requiredOutputs {
				assert.Contains(t, outputsContent, fmt.Sprintf("output \"%s\"", output),
					"Output %s should be defined in %s", output, tc.module)
			}
		})
	}
}

// TestTerraformProviderVersions validates provider version constraints
func TestTerraformProviderVersions(t *testing.T) {
	t.Parallel()

	modules := []string{
		"../aws",
		"../azure",
		"../sentinel", 
		"../examples/complete-deployment",
	}

	for _, module := range modules {
		t.Run(fmt.Sprintf("ProviderVersions-%s", filepath.Base(module)), func(t *testing.T) {
			// Read main.tf or versions.tf file
			var content []byte
			var err error

			for _, filename := range []string{"main.tf", "versions.tf"} {
				filePath := filepath.Join(module, filename)
				if content, err = os.ReadFile(filePath); err == nil {
					break
				}
			}
			assert.NoError(t, err, "Should have main.tf or versions.tf in %s", module)

			fileContent := string(content)

			// Check Terraform version constraint
			assert.Contains(t, fileContent, "required_version",
				"Terraform version should be constrained in %s", module)
			assert.Contains(t, fileContent, ">= 1.0",
				"Terraform version should be >= 1.0 in %s", module)

			// Check provider version constraints
			if strings.Contains(fileContent, "hashicorp/aws") {
				assert.Contains(t, fileContent, "~> 5.0",
					"AWS provider should be constrained to ~> 5.0 in %s", module)
			}

			if strings.Contains(fileContent, "hashicorp/azurerm") {
				assert.Contains(t, fileContent, "~> 3.0",
					"AzureRM provider should be constrained to ~> 3.0 in %s", module)
			}

			if strings.Contains(fileContent, "hashicorp/azuread") {
				assert.Contains(t, fileContent, "~> 2.0",
					"AzureAD provider should be constrained to ~> 2.0 in %s", module)
			}
		})
	}
}

// TestTerraformDocumentation validates that modules have proper documentation
func TestTerraformDocumentation(t *testing.T) {
	t.Parallel()

	modules := []string{
		"../aws",
		"../azure",
		"../sentinel",
		"../examples/complete-deployment",
	}

	for _, module := range modules {
		t.Run(fmt.Sprintf("Documentation-%s", filepath.Base(module)), func(t *testing.T) {
			// Check for README.md
			readmePath := filepath.Join(module, "README.md")
			_, err := os.Stat(readmePath)
			assert.NoError(t, err, "README.md should exist in %s", module)

			if err == nil {
				content, err := os.ReadFile(readmePath)
				assert.NoError(t, err)

				readmeContent := string(content)

				// Check for basic documentation sections
				requiredSections := []string{
					"# ",           // Title
					"## ",          // At least one section
					"Usage",        // Usage section
					"Requirements", // Requirements section
				}

				for _, section := range requiredSections {
					assert.Contains(t, readmeContent, section,
						"README.md should contain %s section in %s", section, module)
				}
			}

			// Check for variables.tf
			variablesPath := filepath.Join(module, "variables.tf")
			_, err = os.Stat(variablesPath)
			assert.NoError(t, err, "variables.tf should exist in %s", module)

			// Check for outputs.tf
			outputsPath := filepath.Join(module, "outputs.tf")
			_, err = os.Stat(outputsPath)
			assert.NoError(t, err, "outputs.tf should exist in %s", module)
		})
	}
}