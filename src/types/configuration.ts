/**
 * Configuration interfaces for the GuardDuty to Sentinel integration system
 */

export interface WorkerConfig {
  /** Batch size for processing findings (default: 100) */
  batchSize: number;
  /** Maximum number of retries for failed operations (default: 3) */
  maxRetries: number;
  /** Initial retry backoff in milliseconds (default: 1000) */
  retryBackoffMs: number;
  /** Enable data normalization before sending to Azure (default: false) */
  enableNormalization: boolean;
  /** Dead letter queue for failed processing (optional) */
  deadLetterQueue?: string;
  /** Azure Monitor ingestion endpoint */
  azureEndpoint: string;
  /** Data Collection Rule configuration */
  dcr: DataCollectionRuleConfig;
  /** AWS configuration */
  aws: AwsConfig;
  /** Azure configuration */
  azure: AzureConfig;
  /** Deduplication configuration */
  deduplication?: DeduplicationConfig;
  /** Monitoring and observability configuration */
  monitoring?: MonitoringConfig;
}

export interface DataCollectionRuleConfig {
  /** DCR immutable ID */
  immutableId: string;
  /** Stream name for ingestion */
  streamName: string;
  /** DCR endpoint URL (optional for new DCRs with built-in endpoints) */
  endpoint?: string;
}

export interface AwsConfig {
  /** AWS region */
  region: string;
  /** S3 bucket name for GuardDuty exports */
  s3BucketName: string;
  /** S3 bucket prefix for GuardDuty exports */
  s3BucketPrefix?: string;
  /** KMS key ARN for S3 decryption */
  kmsKeyArn?: string;
  /** AWS access key ID (optional, can use IAM roles) */
  accessKeyId?: string;
  /** AWS secret access key (optional, can use IAM roles) */
  secretAccessKey?: string;
  /** AWS session token (optional, for temporary credentials) */
  sessionToken?: string;
}

export interface AzureConfig {
  /** Azure tenant ID */
  tenantId: string;
  /** Azure client ID (service principal) */
  clientId: string;
  /** Azure client secret */
  clientSecret: string;
  /** Log Analytics workspace ID */
  workspaceId: string;
  /** Azure subscription ID */
  subscriptionId: string;
  /** Azure resource group name */
  resourceGroupName: string;
}

export interface DeduplicationConfig {
  /** Enable deduplication (default: true) */
  enabled: boolean;
  /** Deduplication strategy */
  strategy: 'findingId' | 'contentHash' | 'timeWindow';
  /** Time window for deduplication in minutes (for timeWindow strategy) */
  timeWindowMinutes?: number;
  /** Cache size for deduplication tracking */
  cacheSize?: number;
}

export interface MonitoringConfig {
  /** Enable metrics collection (default: true) */
  enableMetrics: boolean;
  /** Enable detailed logging (default: false) */
  enableDetailedLogging: boolean;
  /** Health check endpoint port (default: 8080) */
  healthCheckPort?: number;
  /** Metrics backend configuration */
  metricsBackend?: MetricsBackendConfig;
}

export interface MetricsBackendConfig {
  /** Metrics backend type */
  type: 'console' | 'prometheus' | 'cloudwatch' | 'azure-monitor';
  /** Backend-specific configuration */
  config?: Record<string, unknown>;
}

export interface ProcessingBatch {
  /** Unique batch identifier */
  batchId: string;
  /** S3 objects in this batch */
  s3Objects: S3ObjectInfo[];
  /** GuardDuty findings in this batch */
  findings: unknown[]; // Will be GuardDutyFinding[] but keeping flexible for processing
  /** Number of successfully processed findings */
  processedCount: number;
  /** Number of failed findings */
  failedCount: number;
  /** Current retry attempt */
  retryCount: number;
  /** Batch processing status */
  status: 'pending' | 'processing' | 'completed' | 'failed';
  /** Batch creation timestamp */
  createdAt: Date;
  /** Batch last updated timestamp */
  updatedAt: Date;
  /** Error details if batch failed */
  error?: ProcessingError;
}

export interface S3ObjectInfo {
  /** S3 bucket name */
  bucket: string;
  /** S3 object key */
  key: string;
  /** Object size in bytes */
  size: number;
  /** Object last modified timestamp */
  lastModified: Date;
  /** Object ETag */
  etag: string;
  /** KMS encryption key ID (if encrypted) */
  kmsKeyId?: string;
}

export interface ProcessingError {
  /** Error code */
  code: string;
  /** Error message */
  message: string;
  /** Error details */
  details?: Record<string, unknown>;
  /** Timestamp when error occurred */
  timestamp: Date;
  /** Stack trace (for debugging) */
  stackTrace?: string;
}

export interface RetryPolicy {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Initial backoff delay in milliseconds */
  initialBackoffMs: number;
  /** Maximum backoff delay in milliseconds */
  maxBackoffMs: number;
  /** Backoff multiplier for exponential backoff */
  backoffMultiplier: number;
  /** Add jitter to prevent thundering herd (default: true) */
  enableJitter: boolean;
  /** Retryable error codes */
  retryableErrors: string[];
}

export interface HealthCheckStatus {
  /** Overall system health */
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** Timestamp of health check */
  timestamp: Date;
  /** Individual component health */
  components: ComponentHealth[];
  /** System uptime in seconds */
  uptime: number;
  /** System version */
  version: string;
}

export interface ComponentHealth {
  /** Component name */
  name: string;
  /** Component status */
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** Status message */
  message?: string;
  /** Response time in milliseconds */
  responseTime?: number;
  /** Last check timestamp */
  lastCheck: Date;
}

export interface ProcessingMetrics {
  /** Total findings processed */
  totalProcessed: number;
  /** Total processing errors */
  totalErrors: number;
  /** Success rate (0-1) */
  successRate: number;
  /** Average processing time per finding in milliseconds */
  avgProcessingTimeMs: number;
  /** Current batch queue size */
  queueSize: number;
  /** Findings processed per second */
  throughput: number;
  /** Metrics collection timestamp */
  timestamp: Date;
}

export interface NormalizedFinding {
  /** Ingestion timestamp */
  TimeGenerated: Date;
  /** GuardDuty finding ID */
  FindingId: string;
  /** AWS account ID */
  AccountId: string;
  /** AWS region */
  Region: string;
  /** Finding severity (0.0-8.9) */
  Severity: number;
  /** Finding type */
  Type: string;
  /** Finding creation timestamp */
  CreatedAt: Date;
  /** Finding last update timestamp */
  UpdatedAt: Date;
  /** Finding title */
  Title: string;
  /** Finding description */
  Description: string;
  /** AWS service name */
  Service: string;
  /** Resource type */
  ResourceType: string;
  /** EC2 instance ID (if applicable) */
  InstanceId?: string;
  /** Remote IP country (if applicable) */
  RemoteIpCountry?: string;
  /** Remote IP address (if applicable) */
  RemoteIpAddress?: string;
  /** DNS request domain (if applicable) */
  DnsRequestDomain?: string;
  /** Action type (if applicable) */
  ActionType?: string;
  /** Threat names (if applicable) */
  ThreatNames?: string;
  /** Event first seen timestamp (if applicable) */
  EventFirstSeen?: Date;
  /** Event last seen timestamp (if applicable) */
  EventLastSeen?: Date;
  /** Finding count */
  Count?: number;
  /** Finding archived status */
  Archived?: boolean;
  /** Original raw JSON for detailed analysis */
  RawJson: string;
}
