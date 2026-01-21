# Makefile for Terraform Infrastructure Tests

.PHONY: test test-aws test-azure test-sentinel test-integration test-validation test-performance test-compliance clean deps fmt lint

# Default target
test: deps test-validation test-aws test-azure test-sentinel test-integration

# Install dependencies
deps:
	go mod download
	go mod tidy

# Run validation tests (syntax, security, etc.)
test-validation:
	@echo "Running Terraform validation tests..."
	go test -v -timeout 15m -run TestTerraform.*Validation ./...
	go test -v -timeout 10m -run TestTerraform.*Security ./...

# Run AWS infrastructure tests
test-aws:
	@echo "Running AWS infrastructure tests..."
	go test -v -timeout 30m -run TestAWS ./...

# Run Azure infrastructure tests  
test-azure:
	@echo "Running Azure infrastructure tests..."
	go test -v -timeout 30m -run TestAzure ./...

# Run Sentinel analytics tests
test-sentinel:
	@echo "Running Sentinel analytics tests..."
	go test -v -timeout 30m -run TestSentinel ./...

# Run integration tests
test-integration:
	@echo "Running integration tests..."
	go test -v -timeout 45m -run TestComplete ./...
	go test -v -timeout 30m -run TestNetworking ./...
	go test -v -timeout 30m -run TestSecurity ./...
	go test -v -timeout 30m -run TestCost ./...

# Run performance tests
test-performance:
	@echo "Running performance tests..."
	go test -v -timeout 60m -run TestTerraformPerformance ./...
	go test -v -timeout 30m -run TestTerraformResourceCount ./...

# Run compliance tests
test-compliance:
	@echo "Running compliance tests..."
	go test -v -timeout 30m -run TestSecurityCompliance ./...
	go test -v -timeout 20m -run TestCostOptimizationCompliance ./...
	go test -v -timeout 20m -run TestDataGovernanceCompliance ./...
	go test -v -timeout 20m -run TestOperationalCompliance ./...
	go test -v -timeout 15m -run TestComplianceReport ./...

# Run all tests in parallel
test-parallel:
	@echo "Running all tests in parallel..."
	go test -v -timeout 60m -parallel 4 ./...

# Run comprehensive validation suite
test-comprehensive: deps test-validation test-compliance test-performance test-aws test-azure test-sentinel test-integration
	@echo "Comprehensive test suite completed"

# Run specific test
test-specific:
	@echo "Running specific test: $(TEST)"
	go test -v -timeout 30m -run $(TEST) ./...

# Format Go code
fmt:
	go fmt ./...

# Lint Go code
lint:
	golangci-lint run ./...

# Clean test cache and temporary files
clean:
	go clean -testcache
	rm -rf .terraform*
	rm -f terraform.tfstate*
	rm -f *.log
	rm -f compliance_report.json

# Validate Terraform configurations
validate:
	@echo "Validating AWS module..."
	cd ../aws && terraform init -backend=false && terraform validate
	@echo "Validating Azure module..."
	cd ../azure && terraform init -backend=false && terraform validate
	@echo "Validating Sentinel module..."
	cd ../sentinel && terraform init -backend=false && terraform validate
	@echo "Validating complete deployment example..."
	cd ../examples/complete-deployment && terraform init -backend=false && terraform validate

# Security scan
security-scan:
	@echo "Running security scan on Terraform configurations..."
	tfsec ../aws/
	tfsec ../azure/
	tfsec ../sentinel/
	tfsec ../examples/complete-deployment/

# Cost estimation (requires Infracost)
cost-estimate:
	@echo "Estimating infrastructure costs..."
	cd ../examples/complete-deployment && infracost breakdown --path .

# Generate documentation
docs:
	@echo "Generating Terraform documentation..."
	cd ../aws && terraform-docs markdown table . > README_generated.md
	cd ../azure && terraform-docs markdown table . > README_generated.md
	cd ../sentinel && terraform-docs markdown table . > README_generated.md

# Run tests with coverage
test-coverage:
	go test -v -timeout 30m -coverprofile=coverage.out ./...
	go tool cover -html=coverage.out -o coverage.html
	@echo "Coverage report generated: coverage.html"

# Benchmark tests
benchmark:
	go test -v -timeout 30m -bench=. -benchmem ./...

# Run quick tests (validation only)
test-quick:
	@echo "Running quick validation tests..."
	go test -v -timeout 10m -short -run TestTerraform.*Validation ./...

# Run CI/CD pipeline tests
test-ci: deps validate test-validation test-compliance
	@echo "CI/CD pipeline tests completed"

# Help target
help:
	@echo "Available targets:"
	@echo "  test                  - Run core test suite"
	@echo "  test-aws              - Run AWS infrastructure tests"
	@echo "  test-azure            - Run Azure infrastructure tests"
	@echo "  test-sentinel         - Run Sentinel analytics tests"
	@echo "  test-integration      - Run integration tests"
	@echo "  test-validation       - Run validation tests (syntax, security)"
	@echo "  test-performance      - Run performance tests"
	@echo "  test-compliance       - Run compliance tests"
	@echo "  test-comprehensive    - Run all tests including performance"
	@echo "  test-parallel         - Run all tests in parallel"
	@echo "  test-specific         - Run specific test (use TEST=TestName)"
	@echo "  test-coverage         - Run tests with coverage report"
	@echo "  test-quick            - Run quick validation tests only"
	@echo "  test-ci               - Run CI/CD pipeline tests"
	@echo "  validate              - Validate Terraform configurations"
	@echo "  security-scan         - Run security scan on Terraform files"
	@echo "  cost-estimate         - Estimate infrastructure costs"
	@echo "  fmt                   - Format Go code"
	@echo "  lint                  - Lint Go code"
	@echo "  clean                 - Clean test cache and temporary files"
	@echo "  docs                  - Generate Terraform documentation"
	@echo "  benchmark             - Run benchmark tests"
	@echo "  deps                  - Install dependencies"
	@echo "  help                  - Show this help message"