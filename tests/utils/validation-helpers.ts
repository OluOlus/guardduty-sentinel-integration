/**
 * Test data validation and assertion helpers
 * Provides comprehensive validation utilities for GuardDuty data and processing results
 */

import { GuardDutyFinding } from '../../src/types/guardduty';

/**
 * Schema validation helpers
 */
export class SchemaValidators {
  /**
   * Validate GuardDuty finding against the expected schema
   */
  static validateGuardDutyFinding(finding: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Required fields validation
    const requiredFields = [
      'schemaVersion', 'accountId', 'region', 'partition', 'id', 'arn',
      'type', 'resource', 'service', 'severity', 'createdAt', 'updatedAt',
      'title', 'description'
    ];

    requiredFields.forEach(field => {
      if (!(field in finding)) {
        errors.push(`Missing required field: ${field}`);
      }
    });

    // Type validations
    if (finding.schemaVersion && typeof finding.schemaVersion !== 'string') {
      errors.push('schemaVersion must be a string');
    }

    if (finding.accountId && (typeof finding.accountId !== 'string' || !/^\d{12}$/.test(finding.accountId))) {
      errors.push('accountId must be a 12-digit string');
    }

    if (finding.region && typeof finding.region !== 'string') {
      errors.push('region must be a string');
    }

    if (finding.partition && typeof finding.partition !== 'string') {
      errors.push('partition must be a string');
    }

    if (finding.id && typeof finding.id !== 'string') {
      errors.push('id must be a string');
    }

    if (finding.arn && (typeof finding.arn !== 'string' || !finding.arn.startsWith('arn:aws:guardduty:'))) {
      errors.push('arn must be a valid GuardDuty ARN string');
    }

    if (finding.type && typeof finding.type !== 'string') {
      errors.push('type must be a string');
    }

    if (finding.severity && (typeof finding.severity !== 'number' || finding.severity < 0 || finding.severity > 8.9)) {
      errors.push('severity must be a number between 0.0 and 8.9');
    }

    if (finding.createdAt && !this.isValidTimestamp(finding.createdAt)) {
      errors.push('createdAt must be a valid ISO 8601 timestamp');
    }

    if (finding.updatedAt && !this.isValidTimestamp(finding.updatedAt)) {
      errors.push('updatedAt must be a valid ISO 8601 timestamp');
    }

    if (finding.title && typeof finding.title !== 'string') {
      errors.push('title must be a string');
    }

    if (finding.description && typeof finding.description !== 'string') {
      errors.push('description must be a string');
    }

    // Resource validation
    if (finding.resource) {
      const resourceErrors = this.validateResource(finding.resource);
      errors.push(...resourceErrors);
    }

    // Service validation
    if (finding.service) {
      const serviceErrors = this.validateService(finding.service);
      errors.push(...serviceErrors);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  private static validateResource(resource: any): string[] {
    const errors: string[] = [];

    if (!resource.resourceType || typeof resource.resourceType !== 'string') {
      errors.push('resource.resourceType is required and must be a string');
    }

    // Validate specific resource types
    if (resource.resourceType === 'Instance' && resource.instanceDetails) {
      const instanceErrors = this.validateInstanceDetails(resource.instanceDetails);
      errors.push(...instanceErrors.map(e => `resource.instanceDetails.${e}`));
    }

    if (resource.resourceType === 'S3Bucket' && resource.s3BucketDetails) {
      const s3Errors = this.validateS3BucketDetails(resource.s3BucketDetails);
      errors.push(...s3Errors.map(e => `resource.s3BucketDetails.${e}`));
    }

    if (resource.resourceType === 'AccessKey' && resource.accessKeyDetails) {
      const accessKeyErrors = this.validateAccessKeyDetails(resource.accessKeyDetails);
      errors.push(...accessKeyErrors.map(e => `resource.accessKeyDetails.${e}`));
    }

    return errors;
  }

  private static validateService(service: any): string[] {
    const errors: string[] = [];

    const requiredServiceFields = [
      'serviceName', 'detectorId', 'archived', 'count',
      'eventFirstSeen', 'eventLastSeen', 'resourceRole'
    ];

    requiredServiceFields.forEach(field => {
      if (!(field in service)) {
        errors.push(`service.${field} is required`);
      }
    });

    if (service.serviceName && service.serviceName !== 'guardduty') {
      errors.push('service.serviceName must be "guardduty"');
    }

    if (service.archived && typeof service.archived !== 'boolean') {
      errors.push('service.archived must be a boolean');
    }

    if (service.count && (typeof service.count !== 'number' || service.count < 1)) {
      errors.push('service.count must be a positive number');
    }

    if (service.eventFirstSeen && !this.isValidTimestamp(service.eventFirstSeen)) {
      errors.push('service.eventFirstSeen must be a valid ISO 8601 timestamp');
    }

    if (service.eventLastSeen && !this.isValidTimestamp(service.eventLastSeen)) {
      errors.push('service.eventLastSeen must be a valid ISO 8601 timestamp');
    }

    if (service.resourceRole && !['TARGET', 'ACTOR'].includes(service.resourceRole)) {
      errors.push('service.resourceRole must be either "TARGET" or "ACTOR"');
    }

    return errors;
  }

  private static validateInstanceDetails(instanceDetails: any): string[] {
    const errors: string[] = [];

    const requiredFields = ['instanceId', 'instanceType', 'instanceState', 'availabilityZone'];
    requiredFields.forEach(field => {
      if (!(field in instanceDetails)) {
        errors.push(`${field} is required`);
      }
    });

    if (instanceDetails.instanceId && !instanceDetails.instanceId.startsWith('i-')) {
      errors.push('instanceId must start with "i-"');
    }

    if (instanceDetails.platform && !['linux', 'windows'].includes(instanceDetails.platform)) {
      errors.push('platform must be either "linux" or "windows"');
    }

    return errors;
  }

  private static validateS3BucketDetails(s3Details: any): string[] {
    const errors: string[] = [];

    if (!s3Details.name || typeof s3Details.name !== 'string') {
      errors.push('name is required and must be a string');
    }

    if (!s3Details.type || typeof s3Details.type !== 'string') {
      errors.push('type is required and must be a string');
    }

    if (s3Details.name && (s3Details.name.length < 3 || s3Details.name.length > 63)) {
      errors.push('name must be between 3 and 63 characters');
    }

    return errors;
  }

  private static validateAccessKeyDetails(accessKeyDetails: any): string[] {
    const errors: string[] = [];

    if (accessKeyDetails.accessKeyId && !accessKeyDetails.accessKeyId.startsWith('AKIA')) {
      errors.push('accessKeyId must start with "AKIA"');
    }

    if (accessKeyDetails.userType && !['IAMUser', 'Root', 'AssumedRole', 'FederatedUser'].includes(accessKeyDetails.userType)) {
      errors.push('userType must be one of: IAMUser, Root, AssumedRole, FederatedUser');
    }

    return errors;
  }

  private static isValidTimestamp(timestamp: string): boolean {
    if (typeof timestamp !== 'string') return false;
    const date = new Date(timestamp);
    return !isNaN(date.getTime()) && timestamp.includes('T') && timestamp.endsWith('Z');
  }

  /**
   * Validate normalized GuardDuty data for Azure ingestion
   */
  static validateNormalizedData(data: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    const requiredFields = [
      'TimeGenerated', 'FindingId', 'AccountId', 'Region', 'Severity', 'Type', 'RawJson'
    ];

    requiredFields.forEach(field => {
      if (!(field in data)) {
        errors.push(`Missing required field: ${field}`);
      }
    });

    // Type validations for Azure Monitor schema
    if (data.TimeGenerated && !(data.TimeGenerated instanceof Date) && typeof data.TimeGenerated !== 'string') {
      errors.push('TimeGenerated must be a Date object or ISO string');
    }

    if (data.FindingId && typeof data.FindingId !== 'string') {
      errors.push('FindingId must be a string');
    }

    if (data.AccountId && (typeof data.AccountId !== 'string' || !/^\d{12}$/.test(data.AccountId))) {
      errors.push('AccountId must be a 12-digit string');
    }

    if (data.Region && typeof data.Region !== 'string') {
      errors.push('Region must be a string');
    }

    if (data.Severity && (typeof data.Severity !== 'number' || data.Severity < 0 || data.Severity > 8.9)) {
      errors.push('Severity must be a number between 0.0 and 8.9');
    }

    if (data.Type && typeof data.Type !== 'string') {
      errors.push('Type must be a string');
    }

    if (data.RawJson && typeof data.RawJson !== 'string') {
      errors.push('RawJson must be a string');
    }

    // Validate that RawJson is valid JSON
    if (data.RawJson) {
      try {
        JSON.parse(data.RawJson);
      } catch {
        errors.push('RawJson must contain valid JSON');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate batch processing configuration
   */
  static validateBatchConfig(config: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (config.batchSize && (typeof config.batchSize !== 'number' || config.batchSize < 1 || config.batchSize > 1000)) {
      errors.push('batchSize must be a number between 1 and 1000');
    }

    if (config.maxRetries && (typeof config.maxRetries !== 'number' || config.maxRetries < 0 || config.maxRetries > 10)) {
      errors.push('maxRetries must be a number between 0 and 10');
    }

    if (config.retryBackoffMs && (typeof config.retryBackoffMs !== 'number' || config.retryBackoffMs < 0)) {
      errors.push('retryBackoffMs must be a non-negative number');
    }

    if (config.enableNormalization && typeof config.enableNormalization !== 'boolean') {
      errors.push('enableNormalization must be a boolean');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

/**
 * Data consistency validators
 */
export class ConsistencyValidators {
  /**
   * Validate that processed findings maintain data integrity
   */
  static validateDataIntegrity(original: GuardDutyFinding[], processed: any[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (original.length !== processed.length) {
      errors.push(`Count mismatch: original=${original.length}, processed=${processed.length}`);
    }

    for (let i = 0; i < Math.min(original.length, processed.length); i++) {
      const orig = original[i];
      const proc = processed[i];

      // Check key fields are preserved
      if (orig.id !== proc.FindingId) {
        errors.push(`Finding ID mismatch at index ${i}: ${orig.id} !== ${proc.FindingId}`);
      }

      if (orig.accountId !== proc.AccountId) {
        errors.push(`Account ID mismatch at index ${i}: ${orig.accountId} !== ${proc.AccountId}`);
      }

      if (orig.region !== proc.Region) {
        errors.push(`Region mismatch at index ${i}: ${orig.region} !== ${proc.Region}`);
      }

      if (orig.severity !== proc.Severity) {
        errors.push(`Severity mismatch at index ${i}: ${orig.severity} !== ${proc.Severity}`);
      }

      if (orig.type !== proc.Type) {
        errors.push(`Type mismatch at index ${i}: ${orig.type} !== ${proc.Type}`);
      }

      // Validate RawJson contains original data
      if (proc.RawJson) {
        try {
          const rawData = JSON.parse(proc.RawJson);
          if (JSON.stringify(rawData) !== JSON.stringify(orig)) {
            errors.push(`RawJson data mismatch at index ${i}`);
          }
        } catch {
          errors.push(`Invalid RawJson at index ${i}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate batch processing results consistency
   */
  static validateBatchConsistency(inputObjects: any[], result: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (result.totalObjects !== inputObjects.length) {
      errors.push(`Total objects mismatch: expected=${inputObjects.length}, actual=${result.totalObjects}`);
    }

    if (result.processedObjects + result.failedObjects !== result.totalObjects) {
      errors.push(`Processed + failed objects (${result.processedObjects + result.failedObjects}) !== total objects (${result.totalObjects})`);
    }

    if (result.successfulFindings + result.failedFindings !== result.totalFindings) {
      errors.push(`Successful + failed findings (${result.successfulFindings + result.failedFindings}) !== total findings (${result.totalFindings})`);
    }

    if (result.errors.length !== result.failedObjects) {
      errors.push(`Error count (${result.errors.length}) !== failed objects (${result.failedObjects})`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate retry behavior consistency
   */
  static validateRetryConsistency(result: any, maxAttempts: number): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (result.attempts > maxAttempts) {
      errors.push(`Attempts (${result.attempts}) exceeded maximum (${maxAttempts})`);
    }

    if (result.success && result.attempts > 1 && result.errors.length !== result.attempts - 1) {
      errors.push(`Successful retry should have ${result.attempts - 1} errors, but has ${result.errors.length}`);
    }

    if (!result.success && result.errors.length !== result.attempts) {
      errors.push(`Failed retry should have ${result.attempts} errors, but has ${result.errors.length}`);
    }

    if (result.totalTime < 0) {
      errors.push('Total time cannot be negative');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate deduplication results
   */
  static validateDeduplicationConsistency(result: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (result.uniqueFindings + result.duplicatesRemoved !== result.totalFindings) {
      errors.push(`Unique (${result.uniqueFindings}) + duplicates (${result.duplicatesRemoved}) !== total (${result.totalFindings})`);
    }

    if (result.duplicateIds.length !== result.duplicatesRemoved) {
      errors.push(`Duplicate IDs count (${result.duplicateIds.length}) !== duplicates removed (${result.duplicatesRemoved})`);
    }

    if (result.processingTime < 0) {
      errors.push('Processing time cannot be negative');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

/**
 * Performance validation helpers
 */
export class PerformanceValidators {
  /**
   * Validate processing performance meets requirements
   */
  static validateProcessingPerformance(
    itemsProcessed: number,
    timeMs: number,
    requirements: { minItemsPerSecond?: number; maxTimePerItem?: number }
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    const itemsPerSecond = (itemsProcessed / timeMs) * 1000;
    const timePerItem = timeMs / itemsProcessed;

    if (requirements.minItemsPerSecond && itemsPerSecond < requirements.minItemsPerSecond) {
      errors.push(`Processing rate (${itemsPerSecond.toFixed(2)} items/sec) below minimum (${requirements.minItemsPerSecond} items/sec)`);
    }

    if (requirements.maxTimePerItem && timePerItem > requirements.maxTimePerItem) {
      errors.push(`Time per item (${timePerItem.toFixed(2)}ms) exceeds maximum (${requirements.maxTimePerItem}ms)`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate memory usage is within acceptable limits
   */
  static validateMemoryUsage(
    memoryUsageMB: number,
    requirements: { maxMemoryMB?: number }
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (requirements.maxMemoryMB && memoryUsageMB > requirements.maxMemoryMB) {
      errors.push(`Memory usage (${memoryUsageMB}MB) exceeds maximum (${requirements.maxMemoryMB}MB)`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

/**
 * Security validation helpers
 */
export class SecurityValidators {
  /**
   * Validate that sensitive data is properly handled
   */
  static validateDataSecurity(data: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check for potential sensitive data exposure
    const sensitivePatterns = [
      /AKIA[0-9A-Z]{16}/, // AWS Access Key ID
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, // UUID (potential secrets)
      /-----BEGIN [A-Z ]+-----/, // PEM format keys
      /password|secret|key|token/i // Common sensitive field names
    ];

    const dataString = JSON.stringify(data);
    sensitivePatterns.forEach((pattern, index) => {
      if (pattern.test(dataString)) {
        errors.push(`Potential sensitive data detected (pattern ${index + 1})`);
      }
    });

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate encryption requirements
   */
  static validateEncryption(config: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (config.s3Config && !config.s3Config.serverSideEncryption) {
      errors.push('S3 server-side encryption is not enabled');
    }

    if (config.azureConfig && !config.azureConfig.httpsOnly) {
      errors.push('Azure HTTPS-only mode is not enabled');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}