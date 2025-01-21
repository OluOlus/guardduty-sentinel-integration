/**
 * Azure HTTP client for Lambda worker
 * 
 * Handles HTTP requests to Azure Monitor Logs Ingestion API
 * with cross-cloud authentication and network configuration
 */

import https from 'https';
import { URL } from 'url';
import { 
  AzureMonitorIngestionRequest, 
  AzureMonitorIngestionResponse, 
  AzureIngestionError
} from '../../types/azure';
import { AzureConfig, DataCollectionRuleConfig } from '../../types/configuration';

export interface AzureHttpClientOptions {
  /** Azure configuration */
  azureConfig: AzureConfig;
  /** Data Collection Rule configuration */
  dcrConfig: DataCollectionRuleConfig;
  /** Request timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Enable retry on transient failures (default: true) */
  enableRetry?: boolean;
}

export interface AzureAccessToken {
  access_token: string;
  token_type: string;
  expires_in: number;
  expires_at: number;
}

export class AzureHttpClient {
  private readonly azureConfig: AzureConfig;
  private readonly dcrConfig: DataCollectionRuleConfig;
  private readonly timeoutMs: number;
  private readonly enableRetry: boolean;
  private readonly endpoint: string;
  private accessToken: AzureAccessToken | null = null;

  constructor(options: AzureHttpClientOptions) {
    const { azureConfig, dcrConfig, timeoutMs = 30000, enableRetry = true } = options;

    this.azureConfig = azureConfig;
    this.dcrConfig = dcrConfig;
    this.timeoutMs = timeoutMs;
    this.enableRetry = enableRetry;
    
    // Build the ingestion endpoint
    this.endpoint = dcrConfig.endpoint || 
                   `https://${dcrConfig.immutableId}.ingest.monitor.azure.com`;
  }

  /**
   * Ingest data into Azure Monitor Logs using HTTP API
   */
  async ingestData(request: AzureMonitorIngestionRequest): Promise<AzureMonitorIngestionResponse> {
    const startTime = Date.now();
    
    try {
      // Validate request
      this.validateRequest(request);

      // Get access token
      const token = await this.getAccessToken();

      // Prepare data for ingestion
      const preparedData = this.prepareDataForIngestion(request.data);

      // Build ingestion URL
      const ingestionUrl = `${this.endpoint}/dataCollectionRules/${this.dcrConfig.immutableId}/streams/${request.streamName}`;

      // Make HTTP request
      const result = await this.makeHttpRequest(ingestionUrl, preparedData, token.access_token);

      // Process the response
      return this.processIngestionResult(result, request, startTime);

    } catch (error) {
      return this.handleIngestionError(error, request, startTime);
    }
  }

  /**
   * Test connectivity to Azure Monitor
   */
  async testConnection(): Promise<boolean> {
    try {
      // Try to get an access token
      const token = await this.getAccessToken();
      
      // Make a simple test request (this will likely fail but validates auth)
      const testUrl = `${this.endpoint}/dataCollectionRules/${this.dcrConfig.immutableId}`;
      
      try {
        await this.makeHttpRequest(testUrl, [], token.access_token, 'GET');
        return true;
      } catch (error) {
        // Even if the request fails, if we got a proper HTTP error (not network error),
        // it means we can reach Azure
        if (error instanceof Error && error.message.includes('HTTP')) {
          return true;
        }
        return false;
      }
    } catch (error) {
      console.error('Azure connectivity test failed:', error);
      return false;
    }
  }

  /**
   * Get Azure access token using client credentials flow
   */
  private async getAccessToken(): Promise<AzureAccessToken> {
    // Check if we have a valid cached token
    if (this.accessToken && this.accessToken.expires_at > Date.now()) {
      return this.accessToken;
    }

    const tokenUrl = `https://login.microsoftonline.com/${this.azureConfig.tenantId}/oauth2/v2.0/token`;
    
    const tokenData = new URLSearchParams({
      client_id: this.azureConfig.clientId,
      client_secret: this.azureConfig.clientSecret,
      scope: 'https://monitor.azure.com/.default',
      grant_type: 'client_credentials'
    });

    try {
      const response = await this.makeHttpRequest(
        tokenUrl, 
        tokenData.toString(), 
        undefined, 
        'POST',
        { 'Content-Type': 'application/x-www-form-urlencoded' }
      );

      const tokenResponse = JSON.parse(response.body);
      
      if (tokenResponse.error) {
        throw new Error(`Token request failed: ${tokenResponse.error_description || tokenResponse.error}`);
      }

      // Cache the token with expiration
      this.accessToken = {
        access_token: tokenResponse.access_token,
        token_type: tokenResponse.token_type,
        expires_in: tokenResponse.expires_in,
        expires_at: Date.now() + (tokenResponse.expires_in * 1000) - 60000 // 1 minute buffer
      };

      return this.accessToken;

    } catch (error) {
      throw new Error(`Failed to get Azure access token: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Make HTTP request using Node.js https module
   */
  private async makeHttpRequest(
    url: string, 
    data: any, 
    accessToken?: string, 
    method: string = 'POST',
    additionalHeaders: Record<string, string> = {}
  ): Promise<{ statusCode: number; body: string; headers: Record<string, string> }> {
    
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      
      const headers: Record<string, string> = {
        'User-Agent': 'GuardDuty-Sentinel-Lambda/1.0.0',
        ...additionalHeaders
      };

      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      if (method === 'POST' && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }

      let postData = '';
      if (data) {
        if (typeof data === 'string') {
          postData = data;
        } else {
          postData = JSON.stringify(data);
        }
        headers['Content-Length'] = Buffer.byteLength(postData).toString();
      }

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method,
        headers,
        timeout: this.timeoutMs
      };

      const req = https.request(options, (res) => {
        let body = '';
        
        res.on('data', (chunk) => {
          body += chunk;
        });
        
        res.on('end', () => {
          const responseHeaders: Record<string, string> = {};
          Object.entries(res.headers).forEach(([key, value]) => {
            responseHeaders[key] = Array.isArray(value) ? value.join(', ') : value || '';
          });

          resolve({
            statusCode: res.statusCode || 0,
            body,
            headers: responseHeaders
          });
        });
      });

      req.on('error', (error) => {
        reject(new Error(`HTTP request failed: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`HTTP request timed out after ${this.timeoutMs}ms`));
      });

      if (postData) {
        req.write(postData);
      }
      
      req.end();
    });
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
      throw new Error(`Request data size (${dataSize} bytes) exceeds maximum allowed size (${maxSizeBytes} bytes)`);
    }
  }

  /**
   * Prepare data for ingestion by ensuring proper formatting
   */
  private prepareDataForIngestion(data: Record<string, unknown>[]): Record<string, unknown>[] {
    return data.map(record => {
      const prepared = { ...record };

      // Ensure TimeGenerated is present and properly formatted
      if (!prepared.TimeGenerated) {
        prepared.TimeGenerated = new Date().toISOString();
      } else if (prepared.TimeGenerated instanceof Date) {
        prepared.TimeGenerated = prepared.TimeGenerated.toISOString();
      }

      // Handle null/undefined values that might cause issues
      Object.keys(prepared).forEach(key => {
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
    result: { statusCode: number; body: string; headers: Record<string, string> }, 
    request: AzureMonitorIngestionRequest, 
    startTime: number
  ): AzureMonitorIngestionResponse {
    const endTime = Date.now();
    const requestId = this.generateRequestId();

    // Check HTTP status code
    if (result.statusCode >= 200 && result.statusCode < 300) {
      // Success
      return {
        status: 'success',
        acceptedRecords: request.data.length,
        rejectedRecords: 0,
        errors: [],
        timestamp: new Date(endTime),
        requestId
      };
    } else {
      // HTTP error
      let errorMessage = `HTTP ${result.statusCode}`;
      let errorCode = 'HTTP_ERROR';

      try {
        const errorBody = JSON.parse(result.body);
        if (errorBody.error) {
          errorMessage = errorBody.error.message || errorMessage;
          errorCode = errorBody.error.code || errorCode;
        }
      } catch {
        // Use raw body if not JSON
        errorMessage = result.body || errorMessage;
      }

      const azureError: AzureIngestionError = {
        code: errorCode,
        message: errorMessage,
        details: {
          statusCode: result.statusCode,
          requestId,
          headers: result.headers
        }
      };

      return {
        status: 'failed',
        acceptedRecords: 0,
        rejectedRecords: request.data.length,
        errors: [azureError],
        timestamp: new Date(endTime),
        requestId
      };
    }
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

    console.error('Azure HTTP ingestion failed:', {
      error: error.message,
      requestId,
      streamName: request.streamName,
      recordCount: request.data.length,
      duration: endTime - startTime
    });

    // Parse error details
    const azureErrors: AzureIngestionError[] = [];
    
    azureErrors.push({
      code: 'INGESTION_ERROR',
      message: error.message || 'Failed to ingest data into Azure Monitor',
      details: { originalError: error.toString() }
    });

    return {
      status: 'failed',
      acceptedRecords: 0,
      rejectedRecords: request.data.length,
      errors: azureErrors,
      timestamp: new Date(endTime),
      requestId
    };
  }

  /**
   * Generate a unique request ID for tracking
   */
  private generateRequestId(): string {
    return `lambda-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}