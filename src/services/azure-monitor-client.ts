/**
 * Azure Monitor client with Data Collection Rule (DCR) support
 *
 * This client handles ingestion of GuardDuty findings into Azure Monitor Logs
 * using the modern Logs Ingestion API with Data Collection Rules.
 *
 * Requirements: 4.1, 4.2
 */

import { LogsIngestionClient } from '@azure/monitor-ingestion';
import { ClientSecretCredential } from '@azure/identity';
import {
  AzureMonitorIngestionRequest,
  AzureMonitorIngestionResponse,
  AzureIngestionError,
} from '../types/azure.js';
import { AzureConfig, DataCollectionRuleConfig } from '../types/configuration.js';

export interface AzureMonitorClientOptions {
  /** Azure configuration */
  azureConfig: AzureConfig;
  /** Data Collection Rule configuration */
  dcrConfig: DataCollectionRuleConfig;
  /** Request timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Enable retry on transient failures (default: true) */
  enableRetry?: boolean;
}

export class AzureMonitorClient {
  private readonly logsClient: LogsIngestionClient;
  private readonly dcrConfig: DataCollectionRuleConfig;
  private readonly timeoutMs: number;
  private readonly enableRetry: boolean;

  constructor(options: AzureMonitorClientOptions) {
    const { azureConfig, dcrConfig, timeoutMs = 30000, enableRetry = true } = options;

    // Create Azure credential using service principal
    const credential = new ClientSecretCredential(
      azureConfig.tenantId,
      azureConfig.clientId,
      azureConfig.clientSecret
    );

    // Initialize the Logs Ingestion client
    // For DCRs created after March 2024, the endpoint is built-in
    const endpoint =
      dcrConfig.endpoint || `https://${dcrConfig.immutableId}.ingest.monitor.azure.com`;

    this.logsClient = new LogsIngestionClient(endpoint, credential);
    this.dcrConfig = dcrConfig;
    this.timeoutMs = timeoutMs;
    this.enableRetry = enableRetry;
  }

  /**
   * Ingest data into Azure Monitor Logs using the configured DCR
   *
   * @param request - The ingestion request containing data and metadata
   * @returns Promise resolving to ingestion response
   * @throws Error if ingestion fails after retries
   */
  async ingestData(request: AzureMonitorIngestionRequest): Promise<AzureMonitorIngestionResponse> {
    const startTime = Date.now();

    try {
      // Validate request
      this.validateRequest(request);

      // Prepare data for ingestion
      const preparedData = this.prepareDataForIngestion(request.data);

      // Perform ingestion using the Logs Ingestion API
      const result = await this.logsClient.upload(
        this.dcrConfig.immutableId,
        request.streamName,
        preparedData,
        {
          requestOptions: {
            timeout: this.timeoutMs,
          },
        }
      );

      // Process the response
      return this.processIngestionResult(result, request, startTime);
    } catch (error) {
      return this.handleIngestionError(error, request, startTime);
    }
  }

  /**
   * Test connectivity to Azure Monitor
   *
   * @returns Promise resolving to true if connection is successful
   */
  async testConnection(): Promise<boolean> {
    try {
      // Send a minimal test record to validate connectivity
      const testData = [
        {
          TimeGenerated: new Date().toISOString(),
          TestField: 'connectivity-test',
        },
      ];

      const testRequest: AzureMonitorIngestionRequest = {
        data: testData,
        streamName: this.dcrConfig.streamName,
        timestamp: new Date(),
      };

      const response = await this.ingestData(testRequest);
      return response.status === 'success' || response.status === 'partial';
    } catch (error) {
      console.error('Azure Monitor connectivity test failed:', error);
      return false;
    }
  }

  /**
   * Get the DCR configuration
   */
  getDcrConfig(): DataCollectionRuleConfig {
    return { ...this.dcrConfig };
  }

  /**
   * Get the ingestion endpoint URL
   */
  getEndpoint(): string {
    return (
      this.dcrConfig.endpoint || `https://${this.dcrConfig.immutableId}.ingest.monitor.azure.com`
    );
  }

  /**
   * Validate the ingestion request
   */
  private validateRequest(request: AzureMonitorIngestionRequest): void {
    if (!request.data || !Array.isArray(request.data)) {
      throw new Error('Request data must be a non-empty array');
    }

    if (request.data.length === 0) {
      throw new Error('Request data cannot be empty');
    }

    if (!request.streamName || typeof request.streamName !== 'string') {
      throw new Error('Stream name must be a non-empty string');
    }

    // Validate data size (Azure Monitor has limits)
    const dataSize = JSON.stringify(request.data).length;
    const maxSizeBytes = 30 * 1024 * 1024; // 30MB limit

    if (dataSize > maxSizeBytes) {
      throw new Error(
        `Request data size (${dataSize} bytes) exceeds maximum allowed size (${maxSizeBytes} bytes)`
      );
    }
  }

  /**
   * Prepare data for ingestion by ensuring proper formatting
   */
  private prepareDataForIngestion(data: Record<string, unknown>[]): Record<string, unknown>[] {
    return data.map((record) => {
      const prepared = { ...record };

      // Ensure TimeGenerated is present and properly formatted
      if (!prepared.TimeGenerated) {
        prepared.TimeGenerated = new Date().toISOString();
      } else if (prepared.TimeGenerated instanceof Date) {
        prepared.TimeGenerated = prepared.TimeGenerated.toISOString();
      }

      // Handle null/undefined values that might cause issues
      Object.keys(prepared).forEach((key) => {
        if (prepared[key] === null || prepared[key] === undefined) {
          prepared[key] = '';
        }
      });

      return prepared;
    });
  }

  /**
   * Process the ingestion result from Azure Monitor
   */
  private processIngestionResult(
    result: any,
    request: AzureMonitorIngestionRequest,
    startTime: number
  ): AzureMonitorIngestionResponse {
    const endTime = Date.now();
    const requestId = this.generateRequestId();

    // The Azure SDK typically returns void on success, or throws on error
    // We'll construct a success response
    return {
      status: 'success',
      acceptedRecords: request.data.length,
      rejectedRecords: 0,
      errors: [],
      timestamp: new Date(endTime),
      requestId,
    };
  }

  /**
   * Handle ingestion errors and convert to standardized response
   */
  private handleIngestionError(
    error: any,
    request: AzureMonitorIngestionRequest,
    startTime: number
  ): AzureMonitorIngestionResponse {
    const endTime = Date.now();
    const requestId = this.generateRequestId();

    console.error('Azure Monitor ingestion failed:', {
      error: error.message,
      requestId,
      streamName: request.streamName,
      recordCount: request.data.length,
      duration: endTime - startTime,
    });

    // Parse Azure Monitor specific errors
    const azureErrors: AzureIngestionError[] = [];

    if (error.code) {
      azureErrors.push({
        code: error.code,
        message: error.message || 'Unknown Azure Monitor error',
        details: {
          statusCode: error.statusCode,
          requestId: error.requestId || requestId,
        },
      });
    } else {
      azureErrors.push({
        code: 'INGESTION_ERROR',
        message: error.message || 'Failed to ingest data into Azure Monitor',
        details: { originalError: error.toString() },
      });
    }

    return {
      status: 'failed',
      acceptedRecords: 0,
      rejectedRecords: request.data.length,
      errors: azureErrors,
      timestamp: new Date(endTime),
      requestId,
    };
  }

  /**
   * Generate a unique request ID for tracking
   */
  private generateRequestId(): string {
    return `azmon-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Factory function to create Azure Monitor client with validation
 */
export function createAzureMonitorClient(options: AzureMonitorClientOptions): AzureMonitorClient {
  // Validate required configuration
  const { azureConfig, dcrConfig } = options;

  if (!azureConfig.tenantId || !azureConfig.clientId || !azureConfig.clientSecret) {
    throw new Error('Azure configuration must include tenantId, clientId, and clientSecret');
  }

  if (!dcrConfig.immutableId || !dcrConfig.streamName) {
    throw new Error('DCR configuration must include immutableId and streamName');
  }

  return new AzureMonitorClient(options);
}

/**
 * Helper function to create DCR configuration from environment variables
 */
export function createDcrConfigFromEnv(): DataCollectionRuleConfig {
  const immutableId = process.env.AZURE_DCR_IMMUTABLE_ID;
  const streamName = process.env.AZURE_DCR_STREAM_NAME;
  const endpoint = process.env.AZURE_DCR_ENDPOINT;

  if (!immutableId || !streamName) {
    throw new Error(
      'Environment variables AZURE_DCR_IMMUTABLE_ID and AZURE_DCR_STREAM_NAME are required'
    );
  }

  return {
    immutableId,
    streamName,
    endpoint,
  };
}

/**
 * Helper function to create Azure configuration from environment variables
 */
export function createAzureConfigFromEnv(): AzureConfig {
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  const workspaceId = process.env.AZURE_WORKSPACE_ID;
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
  const resourceGroupName = process.env.AZURE_RESOURCE_GROUP_NAME;

  if (
    !tenantId ||
    !clientId ||
    !clientSecret ||
    !workspaceId ||
    !subscriptionId ||
    !resourceGroupName
  ) {
    throw new Error('Required Azure environment variables are missing');
  }

  return {
    tenantId,
    clientId,
    clientSecret,
    workspaceId,
    subscriptionId,
    resourceGroupName,
  };
}
