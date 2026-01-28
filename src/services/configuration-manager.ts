/**
 * Configuration management system for the GuardDuty to Sentinel integration
 *
 * Provides:
 * - Environment variable loading with type conversion
 * - Configuration file support (JSON/YAML) with schema validation
 * - Configuration validation with detailed error messages
 * - Default value handling and environment-specific overrides
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import Ajv, { JSONSchemaType } from 'ajv';
import {
  WorkerConfig,
  AwsConfig,
  AzureConfig,
  DataCollectionRuleConfig,
  DeduplicationConfig,
  MonitoringConfig,
} from '../types/configuration';

export interface ConfigurationSource {
  /** Configuration source type */
  type: 'environment' | 'file' | 'default';
  /** Source location (file path or 'environment') */
  location: string;
  /** Configuration data */
  data: Partial<WorkerConfig>;
}

export interface ConfigurationValidationError {
  /** Field path where validation failed */
  field: string;
  /** Validation error message */
  message: string;
  /** Expected value or type */
  expected?: string;
  /** Actual value that failed validation */
  actual?: unknown;
}

export interface ConfigurationLoadResult {
  /** Successfully loaded and validated configuration */
  config: WorkerConfig;
  /** Configuration sources used (in order of precedence) */
  sources: ConfigurationSource[];
  /** Non-fatal warnings during configuration loading */
  warnings: string[];
}

/**
 * Configuration manager that loads and validates system configuration
 * from multiple sources with proper precedence and validation
 */
export class ConfigurationManager {
  private readonly ajv: Ajv;
  private readonly configSchema: JSONSchemaType<WorkerConfig>;

  constructor() {
    this.ajv = new Ajv({ allErrors: true, verbose: true });
    this.configSchema = this.createConfigSchema();
  }

  /**
   * Load configuration from multiple sources with proper precedence:
   * 1. Environment variables (highest precedence)
   * 2. Configuration file (if specified)
   * 3. Default values (lowest precedence)
   */
  public async loadConfiguration(configFilePath?: string): Promise<ConfigurationLoadResult> {
    const sources: ConfigurationSource[] = [];
    const warnings: string[] = [];

    // Start with default configuration
    const defaultConfig = this.getDefaultConfiguration();
    sources.push({
      type: 'default',
      location: 'built-in defaults',
      data: defaultConfig,
    });

    let mergedConfig: Partial<WorkerConfig> = { ...defaultConfig };

    // Load from configuration file if specified
    if (configFilePath) {
      try {
        const fileConfig = await this.loadConfigurationFile(configFilePath);
        sources.push({
          type: 'file',
          location: configFilePath,
          data: fileConfig,
        });
        mergedConfig = this.mergeConfigurations(mergedConfig, fileConfig);
      } catch (error) {
        warnings.push(
          `Failed to load configuration file ${configFilePath}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Load from environment variables (highest precedence)
    const envConfig = this.loadEnvironmentConfiguration();
    if (Object.keys(envConfig).length > 0) {
      sources.push({
        type: 'environment',
        location: 'environment variables',
        data: envConfig,
      });
      mergedConfig = this.mergeConfigurations(mergedConfig, envConfig);
    }

    // Validate the final configuration
    const validationResult = this.validateConfiguration(mergedConfig);
    if (validationResult.length > 0) {
      const errorMessages = validationResult
        .map(
          (err) =>
            `${err.field}: ${err.message}${err.expected ? ` (expected: ${err.expected})` : ''}`
        )
        .join(', ');
      throw new Error(`Configuration validation failed: ${errorMessages}`);
    }

    return {
      config: mergedConfig as WorkerConfig,
      sources,
      warnings,
    };
  }

  /**
   * Load configuration from a JSON or YAML file
   */
  private async loadConfigurationFile(filePath: string): Promise<Partial<WorkerConfig>> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Configuration file not found: ${filePath}`);
    }

    const fileContent = fs.readFileSync(filePath, 'utf8');
    const fileExtension = path.extname(filePath).toLowerCase();

    let configData: unknown;

    try {
      if (fileExtension === '.json') {
        configData = JSON.parse(fileContent);
      } else if (fileExtension === '.yaml' || fileExtension === '.yml') {
        configData = yaml.load(fileContent);
      } else {
        throw new Error(
          `Unsupported configuration file format: ${fileExtension}. Supported formats: .json, .yaml, .yml`
        );
      }
    } catch (error) {
      throw new Error(
        `Failed to parse configuration file: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (typeof configData !== 'object' || configData === null) {
      throw new Error('Configuration file must contain a valid object');
    }

    return configData as Partial<WorkerConfig>;
  }

  /**
   * Load configuration from environment variables
   */
  private loadEnvironmentConfiguration(): Partial<WorkerConfig> {
    const config: Partial<WorkerConfig> = {};

    // Core worker settings
    if (process.env.BATCH_SIZE) {
      config.batchSize = this.parseInteger('BATCH_SIZE', process.env.BATCH_SIZE);
    }
    if (process.env.MAX_RETRIES) {
      config.maxRetries = this.parseInteger('MAX_RETRIES', process.env.MAX_RETRIES);
    }
    if (process.env.RETRY_BACKOFF_MS) {
      config.retryBackoffMs = this.parseInteger('RETRY_BACKOFF_MS', process.env.RETRY_BACKOFF_MS);
    }
    if (process.env.ENABLE_NORMALIZATION) {
      config.enableNormalization = this.parseBoolean(
        'ENABLE_NORMALIZATION',
        process.env.ENABLE_NORMALIZATION
      );
    }
    if (process.env.DEAD_LETTER_QUEUE) {
      config.deadLetterQueue = process.env.DEAD_LETTER_QUEUE;
    }
    if (process.env.AZURE_ENDPOINT) {
      config.azureEndpoint = process.env.AZURE_ENDPOINT;
    }

    // DCR configuration (AZURE_DCR_*)
    const dcrImmutableId = process.env.AZURE_DCR_IMMUTABLE_ID;
    const dcrStreamName = process.env.AZURE_DCR_STREAM_NAME;
    const dcrEndpoint = process.env.AZURE_DCR_ENDPOINT;
    if (dcrImmutableId || dcrStreamName || dcrEndpoint) {
      config.dcr = {} as DataCollectionRuleConfig;
      if (dcrImmutableId) {
        config.dcr.immutableId = dcrImmutableId;
      }
      if (dcrStreamName) {
        config.dcr.streamName = dcrStreamName;
      }
      if (dcrEndpoint) {
        config.dcr.endpoint = dcrEndpoint;
      }
    }

    // AWS configuration
    if (this.hasAnyAwsEnvVars()) {
      config.aws = {} as AwsConfig;
      if (process.env.AWS_REGION) {
        config.aws.region = process.env.AWS_REGION;
      }
      if (process.env.AWS_S3_BUCKET_NAME) {
        config.aws.s3BucketName = process.env.AWS_S3_BUCKET_NAME;
      }
      if (process.env.AWS_S3_BUCKET_PREFIX) {
        config.aws.s3BucketPrefix = process.env.AWS_S3_BUCKET_PREFIX;
      }
      if (process.env.AWS_KMS_KEY_ARN) {
        config.aws.kmsKeyArn = process.env.AWS_KMS_KEY_ARN;
      }
      if (process.env.AWS_ACCESS_KEY_ID) {
        config.aws.accessKeyId = process.env.AWS_ACCESS_KEY_ID;
      }
      if (process.env.AWS_SECRET_ACCESS_KEY) {
        config.aws.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
      }
      if (process.env.AWS_SESSION_TOKEN) {
        config.aws.sessionToken = process.env.AWS_SESSION_TOKEN;
      }
    }

    // Azure configuration
    if (this.hasAnyAzureEnvVars()) {
      config.azure = {} as AzureConfig;
      if (process.env.AZURE_TENANT_ID) {
        config.azure.tenantId = process.env.AZURE_TENANT_ID;
      }
      if (process.env.AZURE_CLIENT_ID) {
        config.azure.clientId = process.env.AZURE_CLIENT_ID;
      }
      if (process.env.AZURE_CLIENT_SECRET) {
        config.azure.clientSecret = process.env.AZURE_CLIENT_SECRET;
      }
      if (process.env.AZURE_WORKSPACE_ID) {
        config.azure.workspaceId = process.env.AZURE_WORKSPACE_ID;
      }
      if (process.env.AZURE_SUBSCRIPTION_ID) {
        config.azure.subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
      }
      if (process.env.AZURE_RESOURCE_GROUP_NAME) {
        config.azure.resourceGroupName = process.env.AZURE_RESOURCE_GROUP_NAME;
      }
    }

    // Deduplication configuration
    if (this.hasAnyDeduplicationEnvVars()) {
      config.deduplication = {} as DeduplicationConfig;
      if (process.env.DEDUPLICATION_ENABLED) {
        config.deduplication.enabled = this.parseBoolean(
          'DEDUPLICATION_ENABLED',
          process.env.DEDUPLICATION_ENABLED
        );
      }
      if (process.env.DEDUPLICATION_STRATEGY) {
        const strategy = process.env.DEDUPLICATION_STRATEGY;
        if (['findingId', 'contentHash', 'timeWindow'].includes(strategy)) {
          config.deduplication.strategy = strategy as 'findingId' | 'contentHash' | 'timeWindow';
        } else {
          throw new Error(
            `Invalid deduplication strategy: ${strategy}. Valid values: findingId, contentHash, timeWindow`
          );
        }
      }
      if (process.env.DEDUPLICATION_TIME_WINDOW_MINUTES) {
        config.deduplication.timeWindowMinutes = this.parseInteger(
          'DEDUPLICATION_TIME_WINDOW_MINUTES',
          process.env.DEDUPLICATION_TIME_WINDOW_MINUTES
        );
      }
      if (process.env.DEDUPLICATION_CACHE_SIZE) {
        config.deduplication.cacheSize = this.parseInteger(
          'DEDUPLICATION_CACHE_SIZE',
          process.env.DEDUPLICATION_CACHE_SIZE
        );
      }
    }

    // Monitoring configuration
    if (this.hasAnyMonitoringEnvVars()) {
      config.monitoring = {} as MonitoringConfig;
      if (process.env.MONITORING_ENABLE_METRICS) {
        config.monitoring.enableMetrics = this.parseBoolean(
          'MONITORING_ENABLE_METRICS',
          process.env.MONITORING_ENABLE_METRICS
        );
      }
      if (process.env.MONITORING_ENABLE_DETAILED_LOGGING) {
        config.monitoring.enableDetailedLogging = this.parseBoolean(
          'MONITORING_ENABLE_DETAILED_LOGGING',
          process.env.MONITORING_ENABLE_DETAILED_LOGGING
        );
      }
      if (process.env.MONITORING_HEALTH_CHECK_PORT) {
        config.monitoring.healthCheckPort = this.parseInteger(
          'MONITORING_HEALTH_CHECK_PORT',
          process.env.MONITORING_HEALTH_CHECK_PORT
        );
      }
    }

    return config;
  }

  /**
   * Get default configuration values
   */
  private getDefaultConfiguration(): Partial<WorkerConfig> {
    return {
      batchSize: 100,
      maxRetries: 3,
      retryBackoffMs: 1000,
      enableNormalization: false,
      deduplication: {
        enabled: true,
        strategy: 'findingId',
        cacheSize: 10000,
      },
      monitoring: {
        enableMetrics: true,
        enableDetailedLogging: false,
        healthCheckPort: 8080,
      },
    };
  }

  /**
   * Merge two configuration objects with proper precedence
   */
  private mergeConfigurations(
    base: Partial<WorkerConfig>,
    override: Partial<WorkerConfig>
  ): Partial<WorkerConfig> {
    const merged = { ...base };

    // Merge top-level properties
    Object.keys(override).forEach((key) => {
      const typedKey = key as keyof WorkerConfig;
      if (override[typedKey] !== undefined) {
        if (
          typeof override[typedKey] === 'object' &&
          override[typedKey] !== null &&
          !Array.isArray(override[typedKey])
        ) {
          // Deep merge for object properties
          const baseValue = merged[typedKey];
          const overrideValue = override[typedKey];
          if (typeof baseValue === 'object' && baseValue !== null && !Array.isArray(baseValue)) {
            merged[typedKey] = { ...baseValue, ...overrideValue } as any;
          } else {
            merged[typedKey] = overrideValue as any;
          }
        } else {
          // Direct assignment for primitive values and arrays
          merged[typedKey] = override[typedKey] as any;
        }
      }
    });

    return merged;
  }

  /**
   * Validate configuration against schema
   */
  private validateConfiguration(config: Partial<WorkerConfig>): ConfigurationValidationError[] {
    const errors: ConfigurationValidationError[] = [];

    // Required fields validation
    if (!config.azureEndpoint) {
      errors.push({
        field: 'azureEndpoint',
        message: 'Azure endpoint is required',
        expected: 'string (HTTPS URL)',
      });
    }

    if (!config.dcr?.immutableId) {
      errors.push({
        field: 'dcr.immutableId',
        message: 'DCR immutable ID is required',
        expected: 'string',
      });
    }

    if (!config.dcr?.streamName) {
      errors.push({
        field: 'dcr.streamName',
        message: 'DCR stream name is required',
        expected: 'string',
      });
    }

    if (!config.aws?.region) {
      errors.push({
        field: 'aws.region',
        message: 'AWS region is required',
        expected: 'string (AWS region code)',
      });
    }

    if (!config.aws?.s3BucketName) {
      errors.push({
        field: 'aws.s3BucketName',
        message: 'AWS S3 bucket name is required',
        expected: 'string',
      });
    }

    if (!config.azure?.tenantId) {
      errors.push({
        field: 'azure.tenantId',
        message: 'Azure tenant ID is required',
        expected: 'string (UUID)',
      });
    }

    if (!config.azure?.clientId) {
      errors.push({
        field: 'azure.clientId',
        message: 'Azure client ID is required',
        expected: 'string (UUID)',
      });
    }

    if (!config.azure?.clientSecret) {
      errors.push({
        field: 'azure.clientSecret',
        message: 'Azure client secret is required',
        expected: 'string',
      });
    }

    if (!config.azure?.workspaceId) {
      errors.push({
        field: 'azure.workspaceId',
        message: 'Azure workspace ID is required',
        expected: 'string (UUID)',
      });
    }

    if (!config.azure?.subscriptionId) {
      errors.push({
        field: 'azure.subscriptionId',
        message: 'Azure subscription ID is required',
        expected: 'string (UUID)',
      });
    }

    if (!config.azure?.resourceGroupName) {
      errors.push({
        field: 'azure.resourceGroupName',
        message: 'Azure resource group name is required',
        expected: 'string',
      });
    }

    // Value validation
    if (config.batchSize !== undefined && (config.batchSize < 1 || config.batchSize > 1000)) {
      errors.push({
        field: 'batchSize',
        message: 'Batch size must be between 1 and 1000',
        expected: 'number (1-1000)',
        actual: config.batchSize,
      });
    }

    if (config.maxRetries !== undefined && (config.maxRetries < 0 || config.maxRetries > 10)) {
      errors.push({
        field: 'maxRetries',
        message: 'Max retries must be between 0 and 10',
        expected: 'number (0-10)',
        actual: config.maxRetries,
      });
    }

    if (
      config.retryBackoffMs !== undefined &&
      (config.retryBackoffMs < 100 || config.retryBackoffMs > 60000)
    ) {
      errors.push({
        field: 'retryBackoffMs',
        message: 'Retry backoff must be between 100ms and 60000ms',
        expected: 'number (100-60000)',
        actual: config.retryBackoffMs,
      });
    }

    // URL validation
    if (config.azureEndpoint && !this.isValidHttpsUrl(config.azureEndpoint)) {
      errors.push({
        field: 'azureEndpoint',
        message: 'Azure endpoint must be a valid HTTPS URL',
        expected: 'string (HTTPS URL)',
        actual: config.azureEndpoint,
      });
    }

    if (config.dcr?.endpoint && !this.isValidHttpsUrl(config.dcr.endpoint)) {
      errors.push({
        field: 'dcr.endpoint',
        message: 'DCR endpoint must be a valid HTTPS URL',
        expected: 'string (HTTPS URL)',
        actual: config.dcr.endpoint,
      });
    }

    return errors;
  }

  /**
   * Create JSON schema for configuration validation
   */
  private createConfigSchema(): JSONSchemaType<WorkerConfig> {
    return {
      type: 'object',
      properties: {
        batchSize: { type: 'number', minimum: 1, maximum: 1000 },
        maxRetries: { type: 'number', minimum: 0, maximum: 10 },
        retryBackoffMs: { type: 'number', minimum: 100, maximum: 60000 },
        enableNormalization: { type: 'boolean' },
        deadLetterQueue: { type: 'string', nullable: true },
        azureEndpoint: { type: 'string' },
        dcr: {
          type: 'object',
          properties: {
            immutableId: { type: 'string' },
            streamName: { type: 'string' },
            endpoint: { type: 'string', nullable: true },
          },
          required: ['immutableId', 'streamName'],
          additionalProperties: false,
        },
        aws: {
          type: 'object',
          properties: {
            region: { type: 'string' },
            s3BucketName: { type: 'string' },
            s3BucketPrefix: { type: 'string', nullable: true },
            kmsKeyArn: { type: 'string', nullable: true },
            accessKeyId: { type: 'string', nullable: true },
            secretAccessKey: { type: 'string', nullable: true },
            sessionToken: { type: 'string', nullable: true },
          },
          required: ['region', 's3BucketName'],
          additionalProperties: false,
        },
        azure: {
          type: 'object',
          properties: {
            tenantId: { type: 'string' },
            clientId: { type: 'string' },
            clientSecret: { type: 'string' },
            workspaceId: { type: 'string' },
            subscriptionId: { type: 'string' },
            resourceGroupName: { type: 'string' },
          },
          required: [
            'tenantId',
            'clientId',
            'clientSecret',
            'workspaceId',
            'subscriptionId',
            'resourceGroupName',
          ],
          additionalProperties: false,
        },
        deduplication: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            strategy: { type: 'string', enum: ['findingId', 'contentHash', 'timeWindow'] },
            timeWindowMinutes: { type: 'number', nullable: true },
            cacheSize: { type: 'number', nullable: true },
          },
          required: ['enabled', 'strategy'],
          additionalProperties: false,
          nullable: true,
        },
        monitoring: {
          type: 'object',
          properties: {
            enableMetrics: { type: 'boolean' },
            enableDetailedLogging: { type: 'boolean' },
            healthCheckPort: { type: 'number', nullable: true },
            metricsBackend: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['console', 'prometheus', 'cloudwatch', 'azure-monitor'],
                },
                config: { type: 'object', nullable: true, additionalProperties: true },
              },
              required: ['type'],
              additionalProperties: false,
              nullable: true,
            },
          },
          required: ['enableMetrics', 'enableDetailedLogging'],
          additionalProperties: false,
          nullable: true,
        },
      },
      required: [
        'batchSize',
        'maxRetries',
        'retryBackoffMs',
        'enableNormalization',
        'azureEndpoint',
        'dcr',
        'aws',
        'azure',
      ],
      additionalProperties: false,
    };
  }

  // Helper methods for environment variable parsing
  private parseInteger(envVarName: string, value: string): number {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
      throw new Error(`Environment variable ${envVarName} must be a valid integer, got: ${value}`);
    }
    return parsed;
  }

  private parseBoolean(envVarName: string, value: string): boolean {
    const lowerValue = value.toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(lowerValue)) {
      return true;
    }
    if (['false', '0', 'no', 'off'].includes(lowerValue)) {
      return false;
    }
    throw new Error(
      `Environment variable ${envVarName} must be a valid boolean (true/false, 1/0, yes/no, on/off), got: ${value}`
    );
  }

  private isValidHttpsUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  // Helper methods to check if environment variables exist for specific sections
  private hasAnyAwsEnvVars(): boolean {
    return !!(
      process.env.AWS_REGION ||
      process.env.AWS_S3_BUCKET_NAME ||
      process.env.AWS_S3_BUCKET_PREFIX ||
      process.env.AWS_KMS_KEY_ARN ||
      process.env.AWS_ACCESS_KEY_ID ||
      process.env.AWS_SECRET_ACCESS_KEY ||
      process.env.AWS_SESSION_TOKEN
    );
  }

  private hasAnyAzureEnvVars(): boolean {
    return !!(
      process.env.AZURE_TENANT_ID ||
      process.env.AZURE_CLIENT_ID ||
      process.env.AZURE_CLIENT_SECRET ||
      process.env.AZURE_WORKSPACE_ID ||
      process.env.AZURE_SUBSCRIPTION_ID ||
      process.env.AZURE_RESOURCE_GROUP_NAME
    );
  }

  private hasAnyDeduplicationEnvVars(): boolean {
    return !!(
      process.env.DEDUPLICATION_ENABLED ||
      process.env.DEDUPLICATION_STRATEGY ||
      process.env.DEDUPLICATION_TIME_WINDOW_MINUTES ||
      process.env.DEDUPLICATION_CACHE_SIZE
    );
  }

  private hasAnyMonitoringEnvVars(): boolean {
    return !!(
      process.env.MONITORING_ENABLE_METRICS ||
      process.env.MONITORING_ENABLE_DETAILED_LOGGING ||
      process.env.MONITORING_HEALTH_CHECK_PORT
    );
  }
}
