package test

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gruntwork-io/terratest/modules/terraform"
	"github.com/stretchr/testify/assert"
)

// TestTerraformPerformance validates Terraform execution performance
func TestTerraformPerformance(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping performance tests in short mode")
	}

	testCases := []struct {
		name           string
		module         string
		maxInitTime    time.Duration
		maxPlanTime    time.Duration
		maxApplyTime   time.Duration
		maxDestroyTime time.Duration
	}{
		{
			name:           "AWS Module Performance",
			module:         "../aws",
			maxInitTime:    2 * time.Minute,
			maxPlanTime:    1 * time.Minute,
			maxApplyTime:   10 * time.Minute,
			maxDestroyTime: 5 * time.Minute,
		},
		{
			name:           "Azure Module Performance", 
			module:         "../azure",
			maxInitTime:    2 * time.Minute,
			maxPlanTime:    1 * time.Minute,
			maxApplyTime:   15 * time.Minute, // Azure can be slower
			maxDestroyTime: 10 * time.Minute,
		},
		{
			name:           "Sentinel Module Performance",
			module:         "../sentinel",
			maxInitTime:    2 * time.Minute,
			maxPlanTime:    30 * time.Second,
			maxApplyTime:   5 * time.Minute,
			maxDestroyTime: 3 * time.Minute,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			terraformOptions := &terraform.Options{
				TerraformDir: tc.module,
				Vars: map[string]interface{}{
					"name_prefix":       fmt.Sprintf("perf-test-%d", time.Now().Unix()),
					"s3_force_destroy": true, // For AWS module
				},
			}

			// Skip Sentinel module if it requires existing workspace
			if tc.module == "../sentinel" {
				terraformOptions.Vars["resource_group_name"] = "rg-nonexistent"
				terraformOptions.Vars["log_analytics_workspace_name"] = "law-nonexistent"
				
				// Only test init and plan for Sentinel
				start := time.Now()
				terraform.Init(t, terraformOptions)
				initDuration := time.Since(start)
				assert.Less(t, initDuration, tc.maxInitTime, 
					"Init took too long: %v > %v", initDuration, tc.maxInitTime)

				start = time.Now()
				terraform.Plan(t, terraformOptions)
				planDuration := time.Since(start)
				assert.Less(t, planDuration, tc.maxPlanTime,
					"Plan took too long: %v > %v", planDuration, tc.maxPlanTime)
				return
			}

			defer func() {
				start := time.Now()
				terraform.Destroy(t, terraformOptions)
				destroyDuration := time.Since(start)
				assert.Less(t, destroyDuration, tc.maxDestroyTime,
					"Destroy took too long: %v > %v", destroyDuration, tc.maxDestroyTime)
			}()

			// Test init performance
			start := time.Now()
			terraform.Init(t, terraformOptions)
			initDuration := time.Since(start)
			assert.Less(t, initDuration, tc.maxInitTime,
				"Init took too long: %v > %v", initDuration, tc.maxInitTime)

			// Test plan performance
			start = time.Now()
			terraform.Plan(t, terraformOptions)
			planDuration := time.Since(start)
			assert.Less(t, planDuration, tc.maxPlanTime,
				"Plan took too long: %v > %v", planDuration, tc.maxPlanTime)

			// Test apply performance
			start = time.Now()
			terraform.Apply(t, terraformOptions)
			applyDuration := time.Since(start)
			assert.Less(t, applyDuration, tc.maxApplyTime,
				"Apply took too long: %v > %v", applyDuration, tc.maxApplyTime)

			t.Logf("Performance results for %s:", tc.name)
			t.Logf("  Init: %v (max: %v)", initDuration, tc.maxInitTime)
			t.Logf("  Plan: %v (max: %v)", planDuration, tc.maxPlanTime)
			t.Logf("  Apply: %v (max: %v)", applyDuration, tc.maxApplyTime)
		})
	}
}

// TestTerraformResourceCount validates resource count limits for cost control
func TestTerraformResourceCount(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name         string
		module       string
		maxResources int
	}{
		{
			name:         "AWS Module Resource Count",
			module:       "../aws",
			maxResources: 20, // Reasonable limit for AWS resources
		},
		{
			name:         "Azure Module Resource Count",
			module:       "../azure", 
			maxResources: 15, // Reasonable limit for Azure resources
		},
		{
			name:         "Sentinel Module Resource Count",
			module:       "../sentinel",
			maxResources: 25, // Analytics rules and workbooks can add up
		},
		{
			name:         "Complete Deployment Resource Count",
			module:       "../examples/complete-deployment",
			maxResources: 60, // Sum of all modules
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			terraformOptions := &terraform.Options{
				TerraformDir: tc.module,
				Vars: map[string]interface{}{
					"name_prefix": "resource-count-test",
				},
			}

			// Add module-specific variables
			if tc.module == "../sentinel" {
				terraformOptions.Vars["resource_group_name"] = "rg-test"
				terraformOptions.Vars["log_analytics_workspace_name"] = "law-test"
			}

			terraform.Init(t, terraformOptions)
			plan := terraform.Plan(t, terraformOptions)

			// Count resources in plan (rough estimate)
			// This is a simple count of lines containing "will be created"
			resourceCount := 0
			lines := strings.Split(plan, "\n")
			for _, line := range lines {
				if strings.Contains(line, "will be created") {
					resourceCount++
				}
			}

			assert.LessOrEqual(t, resourceCount, tc.maxResources,
				"Too many resources planned: %d > %d", resourceCount, tc.maxResources)

			t.Logf("Resource count for %s: %d (max: %d)", tc.name, resourceCount, tc.maxResources)
		})
	}
}

// BenchmarkTerraformInit benchmarks Terraform init performance
func BenchmarkTerraformInit(b *testing.B) {
	modules := []string{
		"../aws",
		"../azure", 
		"../sentinel",
		"../examples/complete-deployment",
	}

	for _, module := range modules {
		b.Run(fmt.Sprintf("Init-%s", filepath.Base(module)), func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				terraformOptions := &terraform.Options{
					TerraformDir: module,
				}

				// Clean up .terraform directory before each run
				os.RemoveAll(filepath.Join(module, ".terraform"))
				os.Remove(filepath.Join(module, ".terraform.lock.hcl"))

				start := time.Now()
				terraform.Init(b, terraformOptions)
				duration := time.Since(start)

				b.ReportMetric(float64(duration.Milliseconds()), "ms/init")
			}
		})
	}
}

// BenchmarkTerraformPlan benchmarks Terraform plan performance
func BenchmarkTerraformPlan(b *testing.B) {
	modules := []string{
		"../aws",
		"../azure",
	}

	for _, module := range modules {
		b.Run(fmt.Sprintf("Plan-%s", filepath.Base(module)), func(b *testing.B) {
			terraformOptions := &terraform.Options{
				TerraformDir: module,
				Vars: map[string]interface{}{
					"name_prefix": "benchmark-test",
				},
			}

			// Init once before benchmarking
			terraform.Init(b, terraformOptions)

			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				start := time.Now()
				terraform.Plan(b, terraformOptions)
				duration := time.Since(start)

				b.ReportMetric(float64(duration.Milliseconds()), "ms/plan")
			}
		})
	}
}

// TestTerraformStateSize validates Terraform state file size limits
func TestTerraformStateSize(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping state size tests in short mode")
	}

	t.Parallel()

	terraformOptions := &terraform.Options{
		TerraformDir: "../examples/complete-deployment",
		Vars: map[string]interface{}{
			"name_prefix":               "state-size-test",
			"environment":              "test",
			"create_guardduty_detector": true,
			"enable_sentinel":          true,
		},
	}

	defer terraform.Destroy(t, terraformOptions)

	terraform.InitAndApply(t, terraformOptions)

	// Check state file size
	stateFile := filepath.Join(terraformOptions.TerraformDir, "terraform.tfstate")
	info, err := os.Stat(stateFile)
	assert.NoError(t, err)

	// State file should be reasonable size (< 1MB for this deployment)
	maxStateSize := int64(1024 * 1024) // 1MB
	assert.Less(t, info.Size(), maxStateSize,
		"State file too large: %d bytes > %d bytes", info.Size(), maxStateSize)

	t.Logf("State file size: %d bytes", info.Size())
}

// TestTerraformParallelExecution validates parallel execution capabilities
func TestTerraformParallelExecution(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping parallel execution tests in short mode")
	}

	// Test that multiple modules can be planned in parallel
	modules := []string{
		"../aws",
		"../azure",
	}

	results := make(chan struct {
		module   string
		duration time.Duration
		err      error
	}, len(modules))

	// Start parallel operations
	for _, module := range modules {
		go func(mod string) {
			start := time.Now()
			
			terraformOptions := &terraform.Options{
				TerraformDir: mod,
				Vars: map[string]interface{}{
					"name_prefix": fmt.Sprintf("parallel-test-%d", time.Now().UnixNano()),
				},
			}

			var err error
			defer func() {
				results <- struct {
					module   string
					duration time.Duration
					err      error
				}{mod, time.Since(start), err}
			}()

			terraform.Init(t, terraformOptions)
			terraform.Plan(t, terraformOptions)
		}(module)
	}

	// Collect results
	for i := 0; i < len(modules); i++ {
		result := <-results
		assert.NoError(t, result.err, "Parallel execution failed for %s", result.module)
		t.Logf("Parallel execution for %s took %v", result.module, result.duration)
	}
}