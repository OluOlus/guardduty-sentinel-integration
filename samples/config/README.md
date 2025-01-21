# Configuration Samples

This directory contains sample configuration files for the GuardDuty to Sentinel integration system.

## Configuration Sources

The ConfigurationManager loads configuration from multiple sources with the following precedence (highest to lowest):

1. **Environment Variables** (highest precedence)
2. **Configuration File** (JSON or YAML)
3. **Default Values** (lowest precedence)

## Sample Files

### `example-config.json`
Complete JSON configuration file showing all available options with example values.

**Usage:**
```typescript
import { ConfigurationManager } from './src/services/configuration-manager';

const configManager = new ConfigurationManager();
const result = await configManager.loadConfiguration('samples/config/example-config.json');
console.log(result.config);
```

### `example-config.yaml`
Complete YAML configuration file with comments explaining each section.

**Usage:**
```typescript
const result = await configManager.loadConfiguration('samples/config/example-config.yaml');
```

### `environment-variables.env`
Template for environment variable configuration. Copy to `.env` and customize.

**Usage:**
```bash
# Copy and customize
cp samples/config/environment-variables.env .env

# Edit values
nano .env

# Load in your application
source .env
node your-app.js
```

## Configuration Sections

### Core Processing Settings
- `batchSize`: Number of findings to process in each batch (1-1000)
- `maxRetries`: Maximum retry attempts for failed operations (0-10)
- `retryBackoffMs`: Initial retry backoff delay in milliseconds (100-60000)
- `enableNormalization`: Enable data transformation before Azure ingestion
- `deadLetterQueue`: Queue name for failed processing (optional)

### Azure Integration
- `azureEndpoint`: Azure Monitor ingestion endpoint (HTTPS required)
- `dcr`: Data Collection Rule configuration
  - `immutableId`: DCR immutable identifier
  - `streamName`: Stream name for data ingestion
  - `endpoint`: Custom DCR endpoint (optional for new DCRs)

### AWS Configuration
- `aws.region`: AWS region for S3 and KMS operations
- `aws.s3BucketName`: S3 bucket containing GuardDuty exports
- `aws.s3BucketPrefix`: S3 prefix for GuardDuty files (optional)
- `aws.kmsKeyArn`: KMS key for S3 decryption (optional)
- AWS credentials (optional, prefer IAM roles):
  - `aws.accessKeyId`
  - `aws.secretAccessKey`
  - `aws.sessionToken`

### Azure Authentication
- `azure.tenantId`: Azure AD tenant ID
- `azure.clientId`: Service principal client ID
- `azure.clientSecret`: Service principal client secret
- `azure.workspaceId`: Log Analytics workspace ID
- `azure.subscriptionId`: Azure subscription ID
- `azure.resourceGroupName`: Resource group name

### Deduplication
- `deduplication.enabled`: Enable finding deduplication
- `deduplication.strategy`: Deduplication method
  - `findingId`: Use GuardDuty finding ID
  - `contentHash`: Use content hash
  - `timeWindow`: Use time-based windows
- `deduplication.timeWindowMinutes`: Window size for time-based deduplication
- `deduplication.cacheSize`: Cache size for tracking duplicates

### Monitoring
- `monitoring.enableMetrics`: Enable metrics collection
- `monitoring.enableDetailedLogging`: Enable verbose logging
- `monitoring.healthCheckPort`: Health check endpoint port
- `monitoring.metricsBackend`: Metrics backend configuration
  - `type`: Backend type (console, prometheus, cloudwatch, azure-monitor)
  - `config`: Backend-specific settings

## Environment Variable Mapping

| Configuration Path | Environment Variable |
|-------------------|---------------------|
| `batchSize` | `BATCH_SIZE` |
| `maxRetries` | `MAX_RETRIES` |
| `retryBackoffMs` | `RETRY_BACKOFF_MS` |
| `enableNormalization` | `ENABLE_NORMALIZATION` |
| `deadLetterQueue` | `DEAD_LETTER_QUEUE` |
| `azureEndpoint` | `AZURE_ENDPOINT` |
| `dcr.immutableId` | `DCR_IMMUTABLE_ID` |
| `dcr.streamName` | `DCR_STREAM_NAME` |
| `dcr.endpoint` | `DCR_ENDPOINT` |
| `aws.region` | `AWS_REGION` |
| `aws.s3BucketName` | `AWS_S3_BUCKET_NAME` |
| `aws.s3BucketPrefix` | `AWS_S3_BUCKET_PREFIX` |
| `aws.kmsKeyArn` | `AWS_KMS_KEY_ARN` |
| `aws.accessKeyId` | `AWS_ACCESS_KEY_ID` |
| `aws.secretAccessKey` | `AWS_SECRET_ACCESS_KEY` |
| `aws.sessionToken` | `AWS_SESSION_TOKEN` |
| `azure.tenantId` | `AZURE_TENANT_ID` |
| `azure.clientId` | `AZURE_CLIENT_ID` |
| `azure.clientSecret` | `AZURE_CLIENT_SECRET` |
| `azure.workspaceId` | `AZURE_WORKSPACE_ID` |
| `azure.subscriptionId` | `AZURE_SUBSCRIPTION_ID` |
| `azure.resourceGroupName` | `AZURE_RESOURCE_GROUP_NAME` |
| `deduplication.enabled` | `DEDUPLICATION_ENABLED` |
| `deduplication.strategy` | `DEDUPLICATION_STRATEGY` |
| `deduplication.timeWindowMinutes` | `DEDUPLICATION_TIME_WINDOW_MINUTES` |
| `deduplication.cacheSize` | `DEDUPLICATION_CACHE_SIZE` |
| `monitoring.enableMetrics` | `MONITORING_ENABLE_METRICS` |
| `monitoring.enableDetailedLogging` | `MONITORING_ENABLE_DETAILED_LOGGING` |
| `monitoring.healthCheckPort` | `MONITORING_HEALTH_CHECK_PORT` |

## Validation Rules

The ConfigurationManager validates all configuration values:

### Required Fields
- `azureEndpoint` (HTTPS URL)
- `dcr.immutableId`
- `dcr.streamName`
- `aws.region`
- `aws.s3BucketName`
- `azure.tenantId`
- `azure.clientId`
- `azure.clientSecret`
- `azure.workspaceId`
- `azure.subscriptionId`
- `azure.resourceGroupName`

### Value Constraints
- `batchSize`: 1-1000
- `maxRetries`: 0-10
- `retryBackoffMs`: 100-60000ms
- URLs must use HTTPS protocol
- Boolean values: true/false, 1/0, yes/no, on/off

### Error Handling
Configuration validation errors include:
- Field path where validation failed
- Descriptive error message
- Expected value format
- Actual value that failed validation

## Usage Examples

### Basic Usage
```typescript
import { ConfigurationManager } from './src/services/configuration-manager';

const configManager = new ConfigurationManager();

// Load from environment variables only
const result = await configManager.loadConfiguration();

// Load from file with environment overrides
const result = await configManager.loadConfiguration('config.json');

console.log('Configuration loaded from:', result.sources);
console.log('Warnings:', result.warnings);
console.log('Final config:', result.config);
```

### Error Handling
```typescript
try {
  const result = await configManager.loadConfiguration('config.yaml');
  // Use result.config for your application
} catch (error) {
  if (error.message.includes('Configuration validation failed')) {
    console.error('Invalid configuration:', error.message);
    // Handle validation errors
  } else {
    console.error('Configuration loading error:', error.message);
    // Handle file loading errors
  }
}
```

### Environment-Specific Configuration
```typescript
// Development
const devResult = await configManager.loadConfiguration('config/dev.yaml');

// Production (environment variables take precedence)
process.env.ENABLE_NORMALIZATION = 'true';
process.env.BATCH_SIZE = '500';
const prodResult = await configManager.loadConfiguration('config/prod.yaml');
```