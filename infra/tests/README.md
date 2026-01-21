# Terraform Infrastructure Tests

This directory contains comprehensive tests for the GuardDuty to Sentinel integration Terraform modules using [Terratest](https://terratest.gruntwork.io/).

## Overview

The test suite validates:
- **Infrastructure Deployment**: Ensures resources are created correctly
- **Resource Dependencies**: Validates proper resource relationships
- **Security Configuration**: Verifies security best practices
- **Cost Optimization**: Tests cost-effective configurations
- **Network Configuration**: Validates networking and connectivity
- **Compliance**: Ensures configurations meet security standards

## Test Structure

```
tests/
├── aws_test.go           # AWS infrastructure tests
├── azure_test.go         # Azure infrastructure tests  
├── sentinel_test.go      # Sentinel analytics tests
├── integration_test.go   # End-to-end integration tests
├── go.mod               # Go module dependencies
├── Makefile             # Test automation
└── README.md            # This file
```

## Prerequisites

### Required Tools
- [Go](https://golang.org/dl/) >= 1.21
- [Terraform](https://www.terraform.io/downloads.html) >= 1.0
- [AWS CLI](https://aws.amazon.com/cli/) configured with appropriate permissions
- [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli) configured with appropriate permissions

### Optional Tools
- [golangci-lint](https://golangci-lint.run/) for code linting
- [tfsec](https://github.com/aquasecurity/tfsec) for security scanning
- [terraform-docs](https://terraform-docs.io/) for documentation generation
- [Infracost](https://www.infracost.io/) for cost estimation

### AWS Permissions
The test user/role needs permissions for:
- S3 bucket creation and management
- KMS key creation and management
- IAM role and policy creation
- GuardDuty detector management
- CloudWatch log group management

### Azure Permissions
The test user/service principal needs permissions for:
- Resource group creation
- Log Analytics workspace management
- Data Collection Rule/Endpoint creation
- Service principal creation
- RBAC assignment
- Microsoft Sentinel management

## Running Tests

### Quick Start
```bash
# Install dependencies
make deps

# Run core test suite (validation + infrastructure)
make test

# Run comprehensive test suite (includes performance and compliance)
make test-comprehensive

# Run specific test categories
make test-validation      # Syntax, security, naming validation
make test-compliance      # Security and operational compliance
make test-performance     # Performance and benchmarking
make test-aws            # AWS infrastructure tests
make test-azure          # Azure infrastructure tests
make test-sentinel       # Sentinel analytics tests
make test-integration    # End-to-end integration tests

# Run quick validation tests only
make test-quick
```

### Individual Test Categories

#### Validation Tests
```bash
# Test Terraform syntax and configuration
go test -v -timeout 15m -run TestTerraformSyntaxValidation ./...

# Test security configurations
go test -v -timeout 10m -run TestTerraformSecurityScan ./...

# Test resource naming conventions
go test -v -timeout 5m -run TestTerraformResourceNaming ./...

# Test variable validation
go test -v -timeout 10m -run TestTerraformVariableValidation ./...
```

#### Compliance Tests
```bash
# Test security compliance
go test -v -timeout 30m -run TestSecurityCompliance ./...

# Test cost optimization compliance
go test -v -timeout 20m -run TestCostOptimizationCompliance ./...

# Test data governance compliance
go test -v -timeout 20m -run TestDataGovernanceCompliance ./...

# Generate compliance report
go test -v -timeout 15m -run TestComplianceReport ./...
```

#### Performance Tests
```bash
# Test Terraform performance
go test -v -timeout 60m -run TestTerraformPerformance ./...

# Test resource count optimization
go test -v -timeout 30m -run TestTerraformResourceCount ./...

# Run benchmarks
go test -v -timeout 30m -bench=. -benchmem ./...
```

### Parallel Execution
```bash
# Run tests in parallel for faster execution
make test-parallel

# Or with Go directly
go test -v -timeout 60m -parallel 4 ./...
```

## Test Configuration

### Environment Variables
Set these environment variables for test configuration:

```bash
# AWS Configuration
export AWS_REGION=us-east-1
export AWS_PROFILE=your-profile

# Azure Configuration  
export ARM_SUBSCRIPTION_ID=your-subscription-id
export ARM_TENANT_ID=your-tenant-id
export ARM_CLIENT_ID=your-client-id
export ARM_CLIENT_SECRET=your-client-secret

# Test Configuration
export TERRATEST_REGION=us-east-1
export SKIP_TEARDOWN=false  # Set to true to keep resources for debugging
```

### Test Data
Tests use randomized names and configurations to avoid conflicts:
- Resource names include random suffixes
- Tests run in parallel with unique identifiers
- Cleanup is automatic unless `SKIP_TEARDOWN=true`

## Test Categories

### 1. Infrastructure Deployment Tests
Validate that Terraform modules create resources correctly:
- Resource creation and configuration
- Output values and data sources
- Module dependencies and relationships

### 2. Security Configuration Tests
Verify security best practices:
- Encryption at rest and in transit
- Access control and permissions
- Network security configurations
- Compliance with security standards

### 3. Cost Optimization Tests
Ensure cost-effective configurations:
- Lifecycle policies and retention settings
- Resource sizing and scaling
- Optional feature toggles
- Cost monitoring and alerting

### 4. Network and Connectivity Tests
Validate networking configurations:
- Public vs private endpoint access
- Cross-cloud connectivity
- DNS and routing configuration
- Firewall and security group rules

### 5. Integration Tests
Test end-to-end functionality:
- Complete deployment scenarios
- Multi-module dependencies
- Cross-provider integration
- Real-world usage patterns

### 6. Validation Tests
Comprehensive validation of Terraform configurations:
- Syntax and format validation
- Security static analysis
- Resource naming conventions
- Variable constraints and validation
- Provider version compatibility
- Documentation completeness

### 7. Performance Tests
Validate infrastructure deployment performance:
- Terraform execution time benchmarks
- Resource count optimization
- State file size validation
- Parallel execution capabilities

### 8. Compliance Tests
Ensure compliance with security and operational standards:
- Security compliance rules (encryption, access control)
- Cost optimization compliance
- Data governance and privacy compliance
- Operational best practices compliance
- Comprehensive compliance reporting

## Debugging Tests

### Keeping Resources for Investigation
```bash
# Skip cleanup to investigate resources
export SKIP_TEARDOWN=true
go test -v -run TestSpecificTest ./...

# Manual cleanup after investigation
terraform destroy -auto-approve
```

### Verbose Logging
```bash
# Enable detailed Terraform logging
export TF_LOG=DEBUG
export TF_LOG_PATH=terraform.log
go test -v -run TestSpecificTest ./...
```

### Test-Specific Debugging
```bash
# Run single test with maximum verbosity
go test -v -timeout 30m -run TestAWSInfrastructure ./... -args -test.v
```

## Continuous Integration

### GitHub Actions Example
```yaml
name: Infrastructure Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-go@v4
        with:
          go-version: '1.21'
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      
      - name: Configure Azure credentials
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}
      
      - name: Run tests
        run: |
          cd infra/tests
          make deps
          make test
```

### Test Stages
1. **Validation**: Terraform syntax and configuration validation
2. **Security Scan**: Static security analysis with tfsec
3. **Unit Tests**: Individual module testing
4. **Integration Tests**: End-to-end deployment testing
5. **Cleanup**: Resource cleanup and cost reporting

## Performance Considerations

### Test Execution Time
- AWS tests: ~15-20 minutes
- Azure tests: ~20-25 minutes  
- Sentinel tests: ~10-15 minutes
- Integration tests: ~30-45 minutes
- Total (sequential): ~75-105 minutes
- Total (parallel): ~30-45 minutes

### Resource Limits
- Tests create temporary resources that count against quotas
- Use separate test accounts/subscriptions when possible
- Monitor costs and set up billing alerts
- Clean up failed test resources regularly

### Optimization Tips
```bash
# Run only changed modules
make test-aws  # If only AWS module changed

# Use parallel execution
make test-parallel

# Skip expensive tests in development
go test -v -short ./...  # Requires adding build tags
```

## Troubleshooting

### Common Issues

#### 1. Authentication Failures
```bash
# Verify AWS credentials
aws sts get-caller-identity

# Verify Azure credentials  
az account show
```

#### 2. Permission Errors
- Ensure test credentials have sufficient permissions
- Check resource quotas and limits
- Verify subscription/account access

#### 3. Resource Conflicts
- Tests use random names to avoid conflicts
- Clean up previous test runs if needed
- Check for existing resources with similar names

#### 4. Timeout Issues
- Increase test timeout for slow operations
- Use parallel execution to reduce total time
- Skip non-essential tests during development

### Getting Help
1. Check test logs for detailed error messages
2. Verify prerequisites and permissions
3. Run tests individually to isolate issues
4. Use `SKIP_TEARDOWN=true` to investigate resources
5. Check Terraform state and plan output

## Contributing

### Adding New Tests
1. Follow existing test patterns and naming conventions
2. Use Terratest helpers for common operations
3. Include both positive and negative test cases
4. Add appropriate cleanup and error handling
5. Update documentation and Makefile targets

### Test Guidelines
- Tests should be idempotent and independent
- Use descriptive test names and comments
- Include assertions for all critical functionality
- Handle cleanup properly to avoid resource leaks
- Consider cost and execution time impact

### Code Quality
```bash
# Format code
make fmt

# Run linting
make lint

# Generate coverage report
make test-coverage
```