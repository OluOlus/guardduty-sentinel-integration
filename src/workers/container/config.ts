/**
 * Configuration management for Container worker
 * 
 * Handles environment variable loading and validation for containerized deployment
 */

import { WorkerConfig } from '../../types/configuration';

export interface ContainerConfig {
  /** Worker configuration */
  worker: WorkerConfig;
  /** Server host to bind to */
  host: string;
  /** Server port to listen on */
  port: number;
  /** Log level for the container */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** Request timeout in milliseconds */
  requestTimeoutMs: number;
}

/**
 * Create configuration from environment variables
 */
export function createConfigFromEnvironment(): ContainerConfig {
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
    batchSize: parseInt(process.env.BATCH_SIZE || '200', 10), // Larger batches for containers
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
      cacheSize: parseInt(process.env.DEDUPLICATION_CACHE_SIZE || '20000', 10) // Larger cache for containers
    },
    
    monitoring: {
      enableMetrics: process.env.ENABLE_METRICS !== 'false', // Default to true
      enableDetailedLogging: process.env.ENABLE_DETAILED_LOGGING === 'true',
      healthCheckPort: parseInt(process.env.HEALTH_CHECK_PORT || '8080', 10),
      metricsBackend: {
        type: (process.env.METRICS_BACKEND_TYPE as any) || 'prometheus', // Default to Prometheus for containers
        config: process.env.METRICS_BACKEND_CONFIG ? 
                JSON.parse(process.env.METRICS_BACKEND_CONFIG) : undefined
      }
    }
  };

  // Validate configuration
  validateWorkerConfig(workerConfig);

  return {
    worker: workerConfig,
    host: process.env.HOST || '0.0.0.0',
    port: parseInt(process.env.PORT || '3000', 10),
    logLevel: (process.env.LOG_LEVEL as any) || 'info',
    requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS || '60000', 10) // 60s for containers
  };
}

/**
 * Validate worker configuration
 */
function validateWorkerConfig(config: WorkerConfig): void {
  if (config.batchSize <= 0 || config.batchSize > 2000) {
    throw new Error('Batch size must be between 1 and 2000 for containers');
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
}

/**
 * Get sample environment configuration for documentation
 */
export function getSampleEnvironmentConfig(): Record<string, string> {
  return {
    // Server Configuration
    HOST: '0.0.0.0',
    PORT: '3000',
    LOG_LEVEL: 'info',
    REQUEST_TIMEOUT_MS: '60000',
    
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
    AWS_ACCESS_KEY_ID: 'your-access-key-id',
    AWS_SECRET_ACCESS_KEY: 'your-secret-access-key',
    AWS_SESSION_TOKEN: 'your-session-token',
    
    // Processing Configuration (Container optimized)
    BATCH_SIZE: '200', // Larger batches for containers
    MAX_RETRIES: '3',
    RETRY_BACKOFF_MS: '1000',
    ENABLE_NORMALIZATION: 'false',
    DEAD_LETTER_QUEUE: 'your-dlq-name',
    
    // Deduplication Configuration (Container optimized)
    ENABLE_DEDUPLICATION: 'true',
    DEDUPLICATION_STRATEGY: 'findingId',
    DEDUPLICATION_TIME_WINDOW_MINUTES: '60',
    DEDUPLICATION_CACHE_SIZE: '20000', // Larger cache for containers
    
    // Monitoring Configuration (Container optimized)
    ENABLE_METRICS: 'true',
    ENABLE_DETAILED_LOGGING: 'false',
    HEALTH_CHECK_PORT: '8080',
    METRICS_BACKEND_TYPE: 'prometheus', // Default to Prometheus for containers
    METRICS_BACKEND_CONFIG: '{}',
    
    // Environment
    NODE_ENV: 'production'
  };
}

/**
 * Get Docker Compose environment variables
 */
export function getDockerComposeEnvironmentVariables(): Record<string, string> {
  return {
    // Use environment variables or secrets
    ...getSampleEnvironmentConfig(),
    
    // Docker-specific overrides
    HOST: '0.0.0.0',
    PORT: '3000',
    METRICS_BACKEND_TYPE: 'prometheus',
    ENABLE_DETAILED_LOGGING: 'false'
  };
}

/**
 * Get Kubernetes environment variables (for ConfigMap/Secret)
 */
export function getKubernetesEnvironmentVariables(): Record<string, any> {
  return {
    // Server Configuration
    HOST: '0.0.0.0',
    PORT: '3000',
    LOG_LEVEL: 'info',
    REQUEST_TIMEOUT_MS: '60000',
    
    // Processing Configuration
    BATCH_SIZE: '200',
    MAX_RETRIES: '3',
    RETRY_BACKOFF_MS: '1000',
    ENABLE_NORMALIZATION: 'false',
    ENABLE_DEDUPLICATION: 'true',
    DEDUPLICATION_STRATEGY: 'findingId',
    DEDUPLICATION_CACHE_SIZE: '20000',
    
    // Monitoring Configuration
    ENABLE_METRICS: 'true',
    ENABLE_DETAILED_LOGGING: 'false',
    HEALTH_CHECK_PORT: '8080',
    METRICS_BACKEND_TYPE: 'prometheus',
    
    // Environment
    NODE_ENV: 'production',
    
    // Note: Sensitive values should be stored in Kubernetes Secrets:
    // - AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET
    // - AZURE_WORKSPACE_ID, AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP_NAME
    // - AZURE_DCR_IMMUTABLE_ID, AZURE_DCR_STREAM_NAME, AZURE_DCR_ENDPOINT
    // - AWS_REGION, AWS_S3_BUCKET_NAME, AWS_S3_BUCKET_PREFIX, AWS_KMS_KEY_ARN
    // - AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (if not using IAM roles)
  };
}