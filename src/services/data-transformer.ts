/**
 * DataTransformer - Data transformation pipeline for GuardDuty findings
 * 
 * Provides optional normalization and field extraction/mapping for GuardDuty findings
 * before ingestion into Azure Monitor Logs. Supports both raw and normalized modes.
 */

import { GuardDutyFinding } from '../types/guardduty';
import { NormalizedFinding } from '../types/configuration';

export interface DataTransformerConfig {
  /** Enable data normalization (default: false) */
  enableNormalization: boolean;
  /** Include raw JSON in normalized output (default: true) */
  includeRawJson?: boolean;
  /** Maximum field length for string fields (default: 32768) */
  maxFieldLength?: number;
  /** Timezone for timestamp normalization (default: 'UTC') */
  timezone?: string;
  /** Custom field mappings for normalization */
  customFieldMappings?: Record<string, string>;
}

export interface TransformationResult {
  /** Transformed data ready for Azure ingestion */
  data: Record<string, unknown>[];
  /** Number of successfully transformed findings */
  transformedCount: number;
  /** Number of findings that failed transformation */
  failedCount: number;
  /** Transformation errors */
  errors: TransformationError[];
  /** Processing mode used */
  mode: 'raw' | 'normalized';
}

export interface TransformationError {
  /** Index of the finding that failed */
  findingIndex: number;
  /** Finding ID if available */
  findingId?: string;
  /** Error message */
  error: string;
  /** Error timestamp */
  timestamp: Date;
  /** Original finding data (truncated) */
  originalData?: string;
}

export class DataTransformerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly findingIndex?: number,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'DataTransformerError';
  }
}

export class DataTransformer {
  private config: Required<DataTransformerConfig>;

  constructor(config: DataTransformerConfig) {
    this.config = {
      enableNormalization: config.enableNormalization,
      includeRawJson: config.includeRawJson ?? true,
      maxFieldLength: config.maxFieldLength || 32768,
      timezone: config.timezone || 'UTC',
      customFieldMappings: config.customFieldMappings || {}
    };
  }

  /**
   * Transforms an array of GuardDuty findings for Azure ingestion
   */
  async transformFindings(findings: GuardDutyFinding[]): Promise<TransformationResult> {
    const transformedData: Record<string, unknown>[] = [];
    const errors: TransformationError[] = [];
    let transformedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < findings.length; i++) {
      try {
        const finding = findings[i];
        const transformed = this.config.enableNormalization 
          ? await this.transformToNormalized(finding)
          : await this.transformToRaw(finding);
        
        transformedData.push(transformed);
        transformedCount++;
      } catch (error) {
        const transformationError: TransformationError = {
          findingIndex: i,
          findingId: findings[i]?.id,
          error: error instanceof Error ? error.message : 'Unknown transformation error',
          timestamp: new Date(),
          originalData: JSON.stringify(findings[i]).substring(0, 500)
        };
        
        errors.push(transformationError);
        failedCount++;
      }
    }

    return {
      data: transformedData,
      transformedCount,
      failedCount,
      errors,
      mode: this.config.enableNormalization ? 'normalized' : 'raw'
    };
  }

  /**
   * Transforms a single finding for Azure ingestion
   */
  async transformSingleFinding(finding: GuardDutyFinding): Promise<Record<string, unknown>> {
    try {
      return this.config.enableNormalization 
        ? await this.transformToNormalized(finding)
        : await this.transformToRaw(finding);
    } catch (error) {
      throw new DataTransformerError(
        `Failed to transform finding ${finding.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'SingleTransformationError',
        0,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Transforms finding to raw format for Azure ingestion
   */
  private async transformToRaw(finding: GuardDutyFinding): Promise<Record<string, unknown>> {
    // Validate required fields
    this.validateRequiredFields(finding);

    const rawData: Record<string, unknown> = {
      TimeGenerated: new Date().toISOString(),
      FindingId: this.truncateString(finding.id),
      AccountId: this.truncateString(finding.accountId),
      Region: this.truncateString(finding.region),
      Severity: this.normalizeSeverity(finding.severity),
      Type: this.truncateString(finding.type),
      RawJson: JSON.stringify(finding)
    };

    // Apply custom field mappings if any
    return this.applyCustomMappings(rawData);
  }

  /**
   * Transforms finding to normalized format for Azure ingestion
   */
  private async transformToNormalized(finding: GuardDutyFinding): Promise<Record<string, unknown>> {
    // Validate required fields
    this.validateRequiredFields(finding);

    // Get validated dates
    const { createdAt, updatedAt } = this.validateAndConvertDates(finding);

    // Extract normalized fields
    const normalizedData: NormalizedFinding = {
      TimeGenerated: new Date(),
      FindingId: finding.id,
      AccountId: finding.accountId,
      Region: finding.region,
      Severity: this.normalizeSeverity(finding.severity),
      Type: finding.type,
      CreatedAt: createdAt,
      UpdatedAt: updatedAt,
      Title: finding.title,
      Description: finding.description,
      Service: finding.service.serviceName,
      ResourceType: finding.resource.resourceType,
      InstanceId: this.extractInstanceId(finding),
      RemoteIpCountry: this.extractRemoteIpCountry(finding),
      RemoteIpAddress: this.extractRemoteIpAddress(finding),
      RawJson: this.config.includeRawJson ? JSON.stringify(finding) : ''
    };

    // Convert to Azure-compatible format with string truncation
    const azureData: Record<string, unknown> = {
      TimeGenerated: normalizedData.TimeGenerated.toISOString(),
      FindingId: this.truncateString(normalizedData.FindingId),
      AccountId: this.truncateString(normalizedData.AccountId),
      Region: this.truncateString(normalizedData.Region),
      Severity: normalizedData.Severity,
      Type: this.truncateString(normalizedData.Type),
      CreatedAt: normalizedData.CreatedAt.toISOString(),
      UpdatedAt: normalizedData.UpdatedAt.toISOString(),
      Title: this.truncateString(normalizedData.Title),
      Description: this.truncateString(normalizedData.Description),
      Service: this.truncateString(normalizedData.Service),
      ResourceType: this.truncateString(normalizedData.ResourceType),
      ...(normalizedData.InstanceId && { InstanceId: this.truncateString(normalizedData.InstanceId) }),
      ...(normalizedData.RemoteIpCountry && { RemoteIpCountry: this.truncateString(normalizedData.RemoteIpCountry) }),
      ...(normalizedData.RemoteIpAddress && { RemoteIpAddress: this.truncateString(normalizedData.RemoteIpAddress) }),
      ...(this.config.includeRawJson && { RawJson: normalizedData.RawJson })
    };

    // Apply custom field mappings if any
    return this.applyCustomMappings(azureData);
  }

  /**
   * Extracts EC2 instance ID from finding resource details
   */
  private extractInstanceId(finding: GuardDutyFinding): string | undefined {
    try {
      return finding.resource.instanceDetails?.instanceId;
    } catch {
      return undefined;
    }
  }

  /**
   * Extracts remote IP country from finding service details
   */
  private extractRemoteIpCountry(finding: GuardDutyFinding): string | undefined {
    try {
      // Check network connection action first
      const networkAction = finding.service.action?.networkConnectionAction;
      if (networkAction?.remoteIpDetails?.country?.countryName) {
        return networkAction.remoteIpDetails.country.countryName;
      }

      // Check AWS API call action
      const apiAction = finding.service.action?.awsApiCallAction;
      if (apiAction?.remoteIpDetails?.country?.countryName) {
        return apiAction.remoteIpDetails.country.countryName;
      }

      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Extracts remote IP address from finding service details
   */
  private extractRemoteIpAddress(finding: GuardDutyFinding): string | undefined {
    try {
      // Check network connection action first
      const networkAction = finding.service.action?.networkConnectionAction;
      if (networkAction?.remoteIpDetails?.ipAddressV4) {
        return networkAction.remoteIpDetails.ipAddressV4;
      }

      // Check AWS API call action
      const apiAction = finding.service.action?.awsApiCallAction;
      if (apiAction?.remoteIpDetails?.ipAddressV4) {
        return apiAction.remoteIpDetails.ipAddressV4;
      }

      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Normalizes severity value to ensure it's within valid range
   */
  private normalizeSeverity(severity: number): number {
    if (typeof severity !== 'number' || isNaN(severity)) {
      return 0.0;
    }
    
    // Clamp severity between 0.0 and 8.9
    return Math.max(0.0, Math.min(8.9, severity));
  }

  /**
   * Truncates string fields to maximum allowed length
   */
  private truncateString(value: string): string {
    if (typeof value !== 'string') {
      return String(value);
    }
    
    if (value.length <= this.config.maxFieldLength) {
      return value;
    }
    
    return value.substring(0, this.config.maxFieldLength - 3) + '...';
  }

  /**
   * Validates date fields and converts them to Date objects
   */
  private validateAndConvertDates(finding: GuardDutyFinding): { createdAt: Date; updatedAt: Date } {
    let createdAt: Date;
    let updatedAt: Date;

    try {
      createdAt = new Date(finding.createdAt);
      if (isNaN(createdAt.getTime())) {
        throw new Error('Invalid createdAt date');
      }
    } catch {
      throw new Error('Invalid date format in createdAt field');
    }

    try {
      updatedAt = new Date(finding.updatedAt);
      if (isNaN(updatedAt.getTime())) {
        throw new Error('Invalid updatedAt date');
      }
    } catch {
      throw new Error('Invalid date format in updatedAt field');
    }

    return { createdAt, updatedAt };
  }
  /**
   * Validates that required fields are present in the finding
   */
  private validateRequiredFields(finding: GuardDutyFinding): void {
    const requiredFields = [
      'id', 'accountId', 'region', 'type', 'severity', 
      'createdAt', 'updatedAt', 'title', 'description'
    ];

    for (const field of requiredFields) {
      if (!(field in finding) || finding[field as keyof GuardDutyFinding] === null || 
          finding[field as keyof GuardDutyFinding] === undefined) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Validate nested required fields
    if (!finding.service || !finding.service.serviceName) {
      throw new Error('Missing required field: service.serviceName');
    }

    if (!finding.resource || !finding.resource.resourceType) {
      throw new Error('Missing required field: resource.resourceType');
    }

    // Validate date fields
    this.validateAndConvertDates(finding);
  }

  /**
   * Applies custom field mappings to the transformed data
   */
  private applyCustomMappings(data: Record<string, unknown>): Record<string, unknown> {
    if (!this.config.customFieldMappings || Object.keys(this.config.customFieldMappings).length === 0) {
      return data;
    }

    const mappedData: Record<string, unknown> = { ...data };

    for (const [sourceField, targetField] of Object.entries(this.config.customFieldMappings)) {
      if (sourceField in mappedData) {
        mappedData[targetField] = mappedData[sourceField];
        // Optionally remove the original field if it's different from target
        if (sourceField !== targetField) {
          delete mappedData[sourceField];
        }
      }
    }

    return mappedData;
  }

  /**
   * Gets the current transformer configuration
   */
  getConfig(): DataTransformerConfig {
    return { ...this.config };
  }

  /**
   * Updates the transformer configuration
   */
  updateConfig(newConfig: Partial<DataTransformerConfig>): void {
    this.config = {
      ...this.config,
      ...newConfig,
      customFieldMappings: newConfig.customFieldMappings || this.config.customFieldMappings
    };
  }

  /**
   * Validates the transformer configuration
   */
  static validateConfig(config: DataTransformerConfig): void {
    if (typeof config.enableNormalization !== 'boolean') {
      throw new Error('enableNormalization must be a boolean');
    }

    if (config.includeRawJson !== undefined && typeof config.includeRawJson !== 'boolean') {
      throw new Error('includeRawJson must be a boolean');
    }

    if (config.maxFieldLength !== undefined && 
        (typeof config.maxFieldLength !== 'number' || config.maxFieldLength <= 0)) {
      throw new Error('maxFieldLength must be a positive number');
    }

    if (config.timezone !== undefined && typeof config.timezone !== 'string') {
      throw new Error('timezone must be a string');
    }

    if (config.customFieldMappings !== undefined && 
        (typeof config.customFieldMappings !== 'object' || config.customFieldMappings === null)) {
      throw new Error('customFieldMappings must be an object');
    }
  }

  /**
   * Creates a transformer with default configuration
   */
  static createDefault(enableNormalization: boolean = false): DataTransformer {
    return new DataTransformer({
      enableNormalization,
      includeRawJson: true,
      maxFieldLength: 32768,
      timezone: 'UTC'
    });
  }
}