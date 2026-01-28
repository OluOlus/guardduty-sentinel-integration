/**
 * KQL Parser Service
 *
 * Simulates the KQL parser function logic for testing field extraction.
 * This TypeScript implementation mirrors the KQL function behavior for validation.
 */

import { GuardDutyFinding } from '../types/guardduty';
import { NormalizedFinding } from '../types/configuration';

export interface KqlParserConfig {
  /** Enable strict field validation */
  strictValidation?: boolean;
  /** Maximum field length for string fields */
  maxFieldLength?: number;
}

export interface ParsedFields {
  /** Successfully extracted fields */
  extracted: Partial<NormalizedFinding>;
  /** Fields that failed to extract */
  failed: string[];
  /** Parsing errors encountered */
  errors: ParseError[];
}

export interface ParseError {
  /** Field name that failed to parse */
  field: string;
  /** Error message */
  message: string;
  /** Original value that failed */
  originalValue?: unknown;
}

/**
 * KQL Parser Service - simulates Azure KQL function behavior
 */
export class KqlParser {
  private config: Required<KqlParserConfig>;

  constructor(config: KqlParserConfig = {}) {
    this.config = {
      strictValidation: config.strictValidation ?? false,
      maxFieldLength: config.maxFieldLength ?? 32768,
    };
  }

  /**
   * Parses GuardDuty finding JSON and extracts standard fields
   * Simulates the KQL parser function behavior
   */
  async parseFields(rawJson: string): Promise<ParsedFields> {
    const result: ParsedFields = {
      extracted: {},
      failed: [],
      errors: [],
    };

    try {
      // Parse JSON (equivalent to parse_json() in KQL)
      const parsedJson = JSON.parse(rawJson);

      if (!parsedJson || typeof parsedJson !== 'object') {
        throw new Error('Parsed JSON is not an object');
      }

      // Extract standard fields (mirrors KQL function logic)
      this.extractDateField(parsedJson, 'createdAt', 'CreatedAt', result);
      this.extractDateField(parsedJson, 'updatedAt', 'UpdatedAt', result);
      this.extractStringField(parsedJson, 'title', 'Title', result);
      this.extractStringField(parsedJson, 'description', 'Description', result);

      // Extract nested service fields
      this.extractNestedStringField(parsedJson, 'service.serviceName', 'Service', result);

      // Extract resource fields
      this.extractNestedStringField(parsedJson, 'resource.resourceType', 'ResourceType', result);
      this.extractNestedStringField(
        parsedJson,
        'resource.instanceDetails.instanceId',
        'InstanceId',
        result
      );

      // Extract network action fields (optional)
      this.extractNestedStringField(
        parsedJson,
        'service.action.networkConnectionAction.remoteIpDetails.country.countryName',
        'RemoteIpCountry',
        result
      );
      this.extractNestedStringField(
        parsedJson,
        'service.action.networkConnectionAction.remoteIpDetails.ipAddressV4',
        'RemoteIpAddress',
        result
      );

      // Extract DNS action fields (optional)
      this.extractNestedStringField(
        parsedJson,
        'service.action.dnsRequestAction.domain',
        'DnsRequestDomain',
        result
      );
      this.extractNestedStringField(parsedJson, 'service.action.actionType', 'ActionType', result);

      // Extract threat intelligence fields (optional)
      this.extractNestedStringField(
        parsedJson,
        'service.evidence.threatIntelligenceDetails.0.threatNames.0',
        'ThreatNames',
        result
      );

      // Extract event timing fields
      this.extractNestedDateField(parsedJson, 'service.eventFirstSeen', 'EventFirstSeen', result);
      this.extractNestedDateField(parsedJson, 'service.eventLastSeen', 'EventLastSeen', result);

      // Extract count and archived fields
      this.extractNestedNumberField(parsedJson, 'service.count', 'Count', result);
      this.extractNestedBooleanField(parsedJson, 'service.archived', 'Archived', result);
    } catch (error) {
      result.errors.push({
        field: 'root',
        message: error instanceof Error ? error.message : 'Unknown parsing error',
        originalValue: rawJson,
      });
    }

    return result;
  }

  /**
   * Validates that required standard fields are extractable
   */
  async validateStandardFields(finding: GuardDutyFinding): Promise<boolean> {
    const rawJson = JSON.stringify(finding);
    const parsed = await this.parseFields(rawJson);

    // Check that core required fields are extractable
    const requiredFields = ['Service', 'ResourceType'];
    const extractedFields = Object.keys(parsed.extracted);

    return requiredFields.every((field) => extractedFields.includes(field));
  }

  private extractStringField(
    obj: any,
    path: string,
    targetField: string,
    result: ParsedFields
  ): void {
    try {
      const value = this.getNestedValue(obj, path);
      if (value !== undefined && value !== null) {
        const stringValue = String(value);
        result.extracted[targetField as keyof NormalizedFinding] = this.truncateString(
          stringValue
        ) as any;
      } else {
        result.failed.push(targetField);
      }
    } catch (error) {
      result.failed.push(targetField);
      result.errors.push({
        field: targetField,
        message: error instanceof Error ? error.message : 'String extraction failed',
        originalValue: this.getNestedValue(obj, path),
      });
    }
  }

  private extractDateField(
    obj: any,
    path: string,
    targetField: string,
    result: ParsedFields
  ): void {
    try {
      const value = this.getNestedValue(obj, path);
      if (value !== undefined && value !== null) {
        const dateValue = new Date(value);
        if (!isNaN(dateValue.getTime())) {
          result.extracted[targetField as keyof NormalizedFinding] = dateValue as any;
        } else {
          result.failed.push(targetField);
          result.errors.push({
            field: targetField,
            message: 'Invalid date format',
            originalValue: value,
          });
        }
      } else {
        result.failed.push(targetField);
      }
    } catch (error) {
      result.failed.push(targetField);
      result.errors.push({
        field: targetField,
        message: error instanceof Error ? error.message : 'Date extraction failed',
        originalValue: this.getNestedValue(obj, path),
      });
    }
  }

  private extractNestedStringField(
    obj: any,
    path: string,
    targetField: string,
    result: ParsedFields
  ): void {
    this.extractStringField(obj, path, targetField, result);
  }

  private extractNestedDateField(
    obj: any,
    path: string,
    targetField: string,
    result: ParsedFields
  ): void {
    this.extractDateField(obj, path, targetField, result);
  }

  private extractNestedNumberField(
    obj: any,
    path: string,
    targetField: string,
    result: ParsedFields
  ): void {
    try {
      const value = this.getNestedValue(obj, path);
      if (value !== undefined && value !== null) {
        const numberValue = Number(value);
        if (!isNaN(numberValue)) {
          result.extracted[targetField as keyof NormalizedFinding] = numberValue as any;
        } else {
          result.failed.push(targetField);
          result.errors.push({
            field: targetField,
            message: 'Invalid number format',
            originalValue: value,
          });
        }
      } else {
        result.failed.push(targetField);
      }
    } catch (error) {
      result.failed.push(targetField);
      result.errors.push({
        field: targetField,
        message: error instanceof Error ? error.message : 'Number extraction failed',
        originalValue: this.getNestedValue(obj, path),
      });
    }
  }

  private extractNestedBooleanField(
    obj: any,
    path: string,
    targetField: string,
    result: ParsedFields
  ): void {
    try {
      const value = this.getNestedValue(obj, path);
      if (value !== undefined && value !== null) {
        result.extracted[targetField as keyof NormalizedFinding] = Boolean(value) as any;
      } else {
        result.failed.push(targetField);
      }
    } catch (error) {
      result.failed.push(targetField);
      result.errors.push({
        field: targetField,
        message: error instanceof Error ? error.message : 'Boolean extraction failed',
        originalValue: this.getNestedValue(obj, path),
      });
    }
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => {
      if (current === null || current === undefined) {
        return undefined;
      }

      // Handle array indices (e.g., "0" in path)
      if (/^\d+$/.test(key)) {
        const index = parseInt(key, 10);
        return Array.isArray(current) ? current[index] : undefined;
      }

      return current[key];
    }, obj);
  }

  private truncateString(value: string): string {
    if (value.length <= this.config.maxFieldLength) {
      return value;
    }
    return value.substring(0, this.config.maxFieldLength);
  }
}
