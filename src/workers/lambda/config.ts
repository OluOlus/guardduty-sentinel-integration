/**
 * Configuration management for AWS Lambda worker
 * 
 * Handles environment variable loading and validation for Lambda deployment
 */

import { WorkerConfig } from '../../types/configuration';

export interface LambdaConfig {
  /** Worker configuration */
  worker: WorkerConfig;
  /** Log level for the Lambda */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** HTTP request timeout in milliseconds */
  timeoutMs: number;
  /** Lambda memory limit in MB */
  memorySize: number;
}

/**
 * Create configuration from environment variables
 */
export function createConfigFromEnvironment(): LambdaConfig {
  // Validate required environment variables
  const requiredVars = [
    'AZURE_TENANT_ID',
    'AZURE_CLIENT_ID',
    'AZURE_CLIENT_SECRET',
    'AZURE_WORKSPACE_ID',
    'AZURE_SUBSCRIPTION_ID',
    'AZURE_RESOURCE_GROUP_NAME',
    'AZURE_DCR_IMMUTABLE_ID',
    'AZURE_DCR_STREAM_NAME',
    'AWS_REGION',
    'AWS_S3_BUCKET_NAME'
  ];

  const missing = requiredVars.filter(varName => !process.env[varName]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // Build worker configuration
  const workerConfig: WorkerConfig = {
    batchSize: parseInt(process.env.BATCH_SIZE || '50', 10), // Smaller batches for Lambda
    maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
    retryBackoffMs: parseInt(process.env.RETRY_BACKOFF_MS || '1000', 10),
    enableNormalization: process.env.ENABLE_NORMALIZATION === 'true',
    deadLetterQueue: process.env.DEAD_LETTER_QUEUE,
    azureEndpoint: process.env.AZURE_DCR_ENDPOINT || 
                   `https://${process.env.AZURE_DCR_IMMUTABLE_ID}.ingest.monitor.azure.com`,
    
    dcr: {
      immutableId: process.env.AZURE_DCR_IMMUTABLE_ID!,
      streamName: process.env.AZURE_DCR_STREAM_NAME!,
      endpoint: process.env.AZURE_DCR_ENDPOINT
    },
    
    aws: {
      region: process.env.AWS_REGION!,
      s3BucketName: process.env.AWS_S3_BUCKET_NAME!,
      s3BucketPrefix: process.env.AWS_S3_BUCKET_PREFIX,
      kmsKeyArn: process.env.AWS_KMS_KEY_ARN,
      // Lambda typically uses IAM roles, but support explicit credentials
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN
    },
    
    azure: {
      tenantId: process.env.AZURE_TENANT_ID!,
      clientId: process.env.AZURE_CLIENT_ID!,
      clientSecret: process.env.AZURE_CLIENT_SECRET!,
      workspaceId: process.env.AZURE_WORKSPACE_ID!,
      subscriptionId: process.env.AZURE_SUBSCRIPTION_ID!,
      resourceGroupName: process.env.AZURE_RESOURCE_GROUP_NAME!
    },
    
    deduplication: {
      enabled: process.env.ENABLE_DEDUPLICATION !== 'false', // Default to true
      strategy: (process.env.DEDUPLICATION_STRATEGY as any) || 'findingId',
      timeWindowMinutes: parseInt(process.env.DEDUPLICATION_TIME_WINDOW_MINUTES || '60', 10),
      cacheSize: parseInt(process.env.DEDUPLICATION_CACHE_SIZE || '5000', 10) // Smaller cache for Lambda
    },
    
    monitoring: {
      enableMetrics: process.env.ENABLE_METRICS !== 'false', // Default to true
      enableDetailedLogging: process.env.ENABLE_DETAILED_LOGGING === 'true',
      healthCheckPort: 0, // Not used in Lambda
      metricsBackend: {
        type: (process.env.METRICS_BACKEND_TYPE as any) || 'cloudwatch', // Default to CloudWatch for Lambda
        config: process.env.METRICS_BACKEND_CONFIG ? 
                JSON.parse(process.env.METRICS_BACKEND_CONFIG) : undefined
      }
    }
  };

  // Validate configuration
  validateWorkerConfig(workerConfig);

  return {
    worker: workerConfig,
    logLevel: (process.env.LOG_LEVEL as any) || 'info',
    timeoutMs: parseInt(process.env.HTTP_TIMEOUT_MS || '25000', 10), // 25s for Lambda
    memorySize: parseInt(process.env.LAMBDA_MEMORY_SIZE || '512', 10)
  };
}

/**
 * Validate worker configuration
 */
function validateWorkerConfig(config: WorkerConfig): void {
  if (config.batchSize <= 0 || config.batchSize > 500) {
    throw new Error('Batch size must be between 1 and 500 for Lambda');
  }

  if (config.maxRetries < 0 || config.maxRetries > 10) {
    throw new Error('Max retries must be between 0 and 10');
  }

  if (config.retryBackoffMs < 100 || config.retryBackoffMs > 60000) {
    throw new Error('Retry backoff must be between 100ms and 60s');
  }

  if (!config.dcr.immutableId || !config.dcr.streamName) {
    throw new Error('DCR immutable ID and stream name are required');
  }

  if (!config.aws.region || !config.aws.s3BucketName) {
    throw new Error('AWS region and S3 bucket name are required');
  }

  if (!config.azure.tenantId || !config.azure.clientId || !config.azure.clientSecret) {
    throw new Error('Azure tenant ID, client ID, and client secret are required');
  }

  // Validate deduplication strategy
  const validStrategies = ['findingId', 'contentHash', 'timeWindow'];
  if (config.deduplication?.enabled && 
      !validStrategies.includes(config.deduplication.strategy)) {
    throw new Error(`Invalid deduplication strategy. Must be one of: ${validStrategies.join(', ')}`);
  }

  // Validate metrics backend type
  const validBackends = ['console', 'prometheus', 'cloudwatch', 'azure-monitor'];
  if (config.monitoring?.metricsBackend?.type && 
      !validBackends.includes(config.monitoring.metricsBackend.type)) {
    throw new Error(`Invalid metrics backend type. Must be one of: ${validBackends.join(', ')}`);
  }

  // Lambda-specific validations
  if (config.deduplication?.cacheSize && config.deduplication.cacheSize > 10000) {
    console.warn('Large deduplication cache size may impact Lambda memory usage');
  }
}

/**
 * Get sample environment configuration for documentation
 */
export function getSampleEnvironmentConfig(): Record<string, string> {
  return {
    // Azure Configuration
    AZURE_TENANT_ID: 'your-tenant-id',
    AZURE_CLIENT_ID: 'your-client-id',
    AZURE_CLIENT_SECRET: 'your-client-secret',
    AZURE_WORKSPACE_ID: 'your-workspace-id',
    AZURE_SUBSCRIPTION_ID: 'your-subscription-id',
    AZURE_RESOURCE_GROUP_NAME: 'your-resource-group',
    AZURE_DCR_IMMUTABLE_ID: 'dcr-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    AZURE_DCR_STREAM_NAME: 'Custom-GuardDutyFindings',
    AZURE_DCR_ENDPOINT: 'https://dcr-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.ingest.monitor.azure.com',
    
    // AWS Configuration
    AWS_REGION: 'us-east-1',
    AWS_S3_BUCKET_NAME: 'your-guardduty-bucket',
    AWS_S3_BUCKET_PREFIX: 'AWSLogs/123456789012/GuardDuty/',
    AWS_KMS_KEY_ARN: 'arn:aws:kms:us-east-1:123456789012:key/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    
    // Processing Configuration (Lambda optimized)
    BATCH_SIZE: '50', // Smaller batches for Lambda
    MAX_RETRIES: '3',
    RETRY_BACKOFF_MS: '1000',
    ENABLE_NORMALIZATION: 'false',
    DEAD_LETTER_QUEUE: 'guardduty-dlq',
    
    // Deduplication Configuration (Lambda optimized)
    ENABLE_DEDUPLICATION: 'true',
    DEDUPLICATION_STRATEGY: 'findingId',
    DEDUPLICATION_TIME_WINDOW_MINUTES: '60',
    DEDUPLICATION_CACHE_SIZE: '5000', // Smaller cache for Lambda
    
    // Monitoring Configuration (Lambda optimized)
    ENABLE_METRICS: 'true',
    ENABLE_DETAILED_LOGGING: 'false',
    METRICS_BACKEND_TYPE: 'cloudwatch', // Default to CloudWatch for Lambda
    METRICS_BACKEND_CONFIG: '{}',
    
    // Lambda Configuration
    LOG_LEVEL: 'info',
    HTTP_TIMEOUT_MS: '25000', // 25 seconds for Lambda
    LAMBDA_MEMORY_SIZE: '512'
  };
}

/**
 * Get CloudFormation/SAM template environment variables
 */
export function getCloudFormationEnvironmentVariables(): Record<string, any> {
  return {
    Environment: {
      Variables: {
        // Azure Configuration - use Parameters/Secrets
        AZURE_TENANT_ID: { Ref: 'AzureTenantId' },
        AZURE_CLIENT_ID: { Ref: 'AzureClientId' },
        AZURE_CLIENT_SECRET: { Ref: 'AzureClientSecret' },
        AZURE_WORKSPACE_ID: { Ref: 'AzureWorkspaceId' },
        AZURE_SUBSCRIPTION_ID: { Ref: 'AzureSubscriptionId' },
        AZURE_RESOURCE_GROUP_NAME: { Ref: 'AzureResourceGroupName' },
        AZURE_DCR_IMMUTABLE_ID: { Ref: 'AzureDcrImmutableId' },
        AZURE_DCR_STREAM_NAME: { Ref: 'AzureDcrStreamName' },
        
        // AWS Configuration - use Parameters
        AWS_S3_BUCKET_NAME: { Ref: 'S3BucketName' },
        AWS_S3_BUCKET_PREFIX: { Ref: 'S3BucketPrefix' },
        AWS_KMS_KEY_ARN: { Ref: 'KmsKeyArn' },
        
        // Processing Configuration - use defaults or Parameters
        BATCH_SIZE: '50',
        MAX_RETRIES: '3',
        RETRY_BACKOFF_MS: '1000',
        ENABLE_NORMALIZATION: 'false',
        ENABLE_DEDUPLICATION: 'true',
        DEDUPLICATION_STRATEGY: 'findingId',
        DEDUPLICATION_CACHE_SIZE: '5000',
        
        // Monitoring Configuration
        ENABLE_METRICS: 'true',
        METRICS_BACKEND_TYPE: 'cloudwatch',
        LOG_LEVEL: 'info',
        HTTP_TIMEOUT_MS: '25000'
      }
    }
  };
}