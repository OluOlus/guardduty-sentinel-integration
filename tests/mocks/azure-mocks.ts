/**
 * Mock Azure Monitor services for testing
 * Provides configurable mock implementations of Azure Monitor Logs Ingestion API
 */

import { TestUtils } from '../utils/test-helpers';

/**
 * Mock Azure Monitor Logs Ingestion service
 */
export class MockAzureMonitorService {
  private responses: Map<string, any> = new Map();
  private errors: Map<string, Error> = new Map();
  private requestLog: any[] = [];
  private authenticationEnabled: boolean = true;
  private rateLimitEnabled: boolean = false;
  private rateLimitCount: number = 0;
  private rateLimitThreshold: number = 100;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.responses.clear();
    this.errors.clear();
    this.requestLog = [];
    this.authenticationEnabled = true;
    this.rateLimitEnabled = false;
    this.rateLimitCount = 0;
    this.rateLimitThreshold = 100;
  }

  // Configuration methods
  setResponse(endpoint: string, response: any): void {
    this.responses.set(endpoint, response);
  }

  setError(endpoint: string, error: Error): void {
    this.errors.set(endpoint, error);
  }

  enableAuthentication(enabled: boolean = true): void {
    this.authenticationEnabled = enabled;
  }

  enableRateLimit(enabled: boolean = true, threshold: number = 100): void {
    this.rateLimitEnabled = enabled;
    this.rateLimitThreshold = threshold;
    this.rateLimitCount = 0;
  }

  getRequestLog(): any[] {
    return [...this.requestLog];
  }

  clearRequestLog(): void {
    this.requestLog = [];
  }

  // Mock HTTP client methods
  createMockHttpClient(): any {
    return {
      post: jest.fn().mockImplementation((url: string, data: any, config: any) => {
        return this.handleRequest('POST', url, data, config);
      }),
      get: jest.fn().mockImplementation((url: string, config: any) => {
        return this.handleRequest('GET', url, null, config);
      }),
      put: jest.fn().mockImplementation((url: string, data: any, config: any) => {
        return this.handleRequest('PUT', url, data, config);
      }),
      delete: jest.fn().mockImplementation((url: string, config: any) => {
        return this.handleRequest('DELETE', url, null, config);
      })
    };
  }

  // Mock Azure Monitor Logs Ingestion client
  createMockLogsIngestionClient(): any {
    return {
      upload: jest.fn().mockImplementation((ruleId: string, streamName: string, logs: any[]) => {
        return this.handleLogsUpload(ruleId, streamName, logs);
      })
    };
  }

  private async handleRequest(method: string, url: string, data: any, config: any): Promise<any> {
    // Log the request
    this.requestLog.push({
      method,
      url,
      data,
      config,
      timestamp: new Date()
    });

    // Check authentication
    if (this.authenticationEnabled && !this.isAuthenticated(config)) {
      const error = new Error('Unauthorized');
      (error as any).response = {
        status: 401,
        statusText: 'Unauthorized',
        data: { error: 'invalid_token', error_description: 'The access token is invalid' }
      };
      throw error;
    }

    // Check rate limiting
    if (this.rateLimitEnabled) {
      this.rateLimitCount++;
      if (this.rateLimitCount > this.rateLimitThreshold) {
        const error = new Error('Too Many Requests');
        (error as any).response = {
          status: 429,
          statusText: 'Too Many Requests',
          headers: {
            'retry-after': '60',
            'x-ratelimit-remaining': '0'
          },
          data: { error: 'rate_limit_exceeded', message: 'Request rate limit exceeded' }
        };
        throw error;
      }
    }

    // Check for configured errors
    const endpoint = this.extractEndpoint(url);
    if (this.errors.has(endpoint)) {
      throw this.errors.get(endpoint);
    }

    // Check for configured responses
    if (this.responses.has(endpoint)) {
      return {
        status: 200,
        statusText: 'OK',
        data: this.responses.get(endpoint),
        headers: {
          'content-type': 'application/json',
          'x-request-id': TestUtils.generateRandomString(32)
        }
      };
    }

    // Default successful response
    return this.createDefaultResponse(method, url, data);
  }

  private async handleLogsUpload(ruleId: string, streamName: string, logs: any[]): Promise<any> {
    const endpoint = `dcr/${ruleId}/stream/${streamName}`;
    
    // Log the upload request
    this.requestLog.push({
      method: 'UPLOAD',
      endpoint,
      ruleId,
      streamName,
      logCount: logs.length,
      timestamp: new Date()
    });

    // Check for configured errors
    if (this.errors.has(endpoint)) {
      throw this.errors.get(endpoint);
    }

    // Validate logs format
    if (!Array.isArray(logs)) {
      const error = new Error('Invalid logs format');
      (error as any).response = {
        status: 400,
        statusText: 'Bad Request',
        data: { error: 'invalid_format', message: 'Logs must be an array' }
      };
      throw error;
    }

    // Check for configured responses
    if (this.responses.has(endpoint)) {
      return this.responses.get(endpoint);
    }

    // Default successful upload response
    return {
      status: 'Accepted',
      requestId: TestUtils.generateRandomString(32),
      timestamp: new Date().toISOString()
    };
  }

  private isAuthenticated(config: any): boolean {
    const authHeader = config?.headers?.Authorization || config?.headers?.authorization;
    return authHeader && authHeader.startsWith('Bearer ');
  }

  private extractEndpoint(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.pathname;
    } catch {
      return url;
    }
  }

  private createDefaultResponse(method: string, url: string, data: any): any {
    const endpoint = this.extractEndpoint(url);
    
    if (endpoint.includes('/dataCollectionRules/')) {
      return {
        status: 200,
        statusText: 'OK',
        data: {
          id: TestUtils.generateRandomString(32),
          name: 'test-dcr',
          location: 'eastus',
          kind: 'Direct',
          properties: {
            immutableId: `dcr-${TestUtils.generateRandomString(32)}`,
            dataCollectionEndpointId: `/subscriptions/test/resourceGroups/test/providers/Microsoft.Insights/dataCollectionEndpoints/test-dce`,
            streamDeclarations: {
              'Custom-GuardDutyFindings': {
                columns: [
                  { name: 'TimeGenerated', type: 'datetime' },
                  { name: 'FindingId', type: 'string' },
                  { name: 'AccountId', type: 'string' },
                  { name: 'Region', type: 'string' },
                  { name: 'Severity', type: 'real' },
                  { name: 'Type', type: 'string' },
                  { name: 'RawJson', type: 'string' }
                ]
              }
            },
            destinations: {
              logAnalytics: [{
                workspaceResourceId: '/subscriptions/test/resourceGroups/test/providers/Microsoft.OperationalInsights/workspaces/test-workspace',
                name: 'LogAnalyticsDest'
              }]
            },
            dataFlows: [{
              streams: ['Custom-GuardDutyFindings'],
              destinations: ['LogAnalyticsDest'],
              transformKql: 'source | extend TimeGenerated = now()',
              outputStream: 'Custom-RawGuardDuty_CL'
            }]
          }
        },
        headers: {
          'content-type': 'application/json',
          'x-request-id': TestUtils.generateRandomString(32)
        }
      };
    }

    if (endpoint.includes('/upload')) {
      return {
        status: 204,
        statusText: 'No Content',
        data: null,
        headers: {
          'x-request-id': TestUtils.generateRandomString(32),
          'x-ms-request-id': TestUtils.generateRandomString(32)
        }
      };
    }

    // Generic successful response
    return {
      status: 200,
      statusText: 'OK',
      data: { success: true, timestamp: new Date().toISOString() },
      headers: {
        'content-type': 'application/json',
        'x-request-id': TestUtils.generateRandomString(32)
      }
    };
  }

  // Helper methods for common test scenarios
  simulateAuthenticationFailure(endpoint: string): void {
    const error = new Error('Unauthorized');
    (error as any).response = {
      status: 401,
      statusText: 'Unauthorized',
      data: { error: 'invalid_token', error_description: 'The access token is invalid' }
    };
    this.setError(endpoint, error);
  }

  simulateRateLimitExceeded(endpoint: string): void {
    const error = new Error('Too Many Requests');
    (error as any).response = {
      status: 429,
      statusText: 'Too Many Requests',
      headers: {
        'retry-after': '60',
        'x-ratelimit-remaining': '0'
      },
      data: { error: 'rate_limit_exceeded', message: 'Request rate limit exceeded' }
    };
    this.setError(endpoint, error);
  }

  simulateSchemaValidationError(endpoint: string): void {
    const error = new Error('Bad Request');
    (error as any).response = {
      status: 400,
      statusText: 'Bad Request',
      data: {
        error: 'schema_validation_failed',
        message: 'The provided data does not match the expected schema',
        details: [
          { field: 'TimeGenerated', error: 'Required field missing' },
          { field: 'Severity', error: 'Invalid data type, expected number' }
        ]
      }
    };
    this.setError(endpoint, error);
  }

  simulateServiceUnavailable(endpoint: string): void {
    const error = new Error('Service Unavailable');
    (error as any).response = {
      status: 503,
      statusText: 'Service Unavailable',
      data: { error: 'service_unavailable', message: 'The service is temporarily unavailable' }
    };
    this.setError(endpoint, error);
  }

  simulateNetworkTimeout(endpoint: string): void {
    const error = new Error('Network timeout');
    (error as any).code = 'ECONNABORTED';
    (error as any).timeout = true;
    this.setError(endpoint, error);
  }

  // Test scenario helpers
  setupSuccessfulIngestionScenario(): void {
    this.setResponse('/dataCollectionRules/test-dcr/streams/Custom-GuardDutyFindings/upload', {
      status: 'Accepted',
      requestId: TestUtils.generateRandomString(32)
    });
  }

  setupPartialFailureScenario(): void {
    this.setResponse('/dataCollectionRules/test-dcr/streams/Custom-GuardDutyFindings/upload', {
      status: 'PartialSuccess',
      requestId: TestUtils.generateRandomString(32),
      acceptedRecords: 8,
      rejectedRecords: 2,
      errors: [
        { index: 3, error: 'Invalid timestamp format' },
        { index: 7, error: 'Missing required field: FindingId' }
      ]
    });
  }

  getIngestionMetrics(): any {
    const uploads = this.requestLog.filter(req => req.method === 'UPLOAD');
    const totalLogs = uploads.reduce((sum, req) => sum + (req.logCount || 0), 0);
    
    return {
      totalRequests: this.requestLog.length,
      totalUploads: uploads.length,
      totalLogs,
      averageLogsPerUpload: uploads.length > 0 ? totalLogs / uploads.length : 0,
      requestsByStatus: this.requestLog.reduce((acc, req) => {
        const status = req.response?.status || 'pending';
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    };
  }
}

/**
 * Mock Azure authentication service
 */
export class MockAzureAuthService {
  private accessTokens: Map<string, any> = new Map();
  private errors: Map<string, Error> = new Map();

  constructor() {
    this.reset();
  }

  reset(): void {
    this.accessTokens.clear();
    this.errors.clear();
  }

  setAccessToken(clientId: string, token: any): void {
    this.accessTokens.set(clientId, token);
  }

  setError(clientId: string, error: Error): void {
    this.errors.set(clientId, error);
  }

  createMockCredential(): any {
    return {
      getToken: jest.fn().mockImplementation((scopes: string[]) => {
        return this.handleGetToken(scopes);
      })
    };
  }

  private async handleGetToken(scopes: string[]): Promise<any> {
    const clientId = 'default'; // Simplified for testing

    if (this.errors.has(clientId)) {
      throw this.errors.get(clientId);
    }

    if (this.accessTokens.has(clientId)) {
      return this.accessTokens.get(clientId);
    }

    // Default token
    return {
      token: `mock_access_token_${TestUtils.generateRandomString(32)}`,
      expiresOnTimestamp: Date.now() + 3600000 // 1 hour from now
    };
  }

  simulateAuthenticationFailure(clientId: string = 'default'): void {
    const error = new Error('Authentication failed');
    (error as any).code = 'AUTHENTICATION_FAILED';
    this.setError(clientId, error);
  }

  simulateTokenExpired(clientId: string = 'default'): void {
    const error = new Error('Token expired');
    (error as any).code = 'TOKEN_EXPIRED';
    this.setError(clientId, error);
  }
}

/**
 * Combined Azure mock factory for easy setup
 */
export class AzureMockFactory {
  static createMonitorMock(): MockAzureMonitorService {
    return new MockAzureMonitorService();
  }

  static createAuthMock(): MockAzureAuthService {
    return new MockAzureAuthService();
  }

  static createCompleteAzureMocks(): { monitor: MockAzureMonitorService; auth: MockAzureAuthService } {
    return {
      monitor: new MockAzureMonitorService(),
      auth: new MockAzureAuthService()
    };
  }

  static setupDefaultScenario(monitorMock: MockAzureMonitorService, authMock: MockAzureAuthService): void {
    // Setup successful authentication
    authMock.setAccessToken('default', {
      token: 'mock_access_token_12345',
      expiresOnTimestamp: Date.now() + 3600000
    });

    // Setup successful ingestion
    monitorMock.setupSuccessfulIngestionScenario();
    monitorMock.enableAuthentication(true);
  }

  static setupErrorScenarios(monitorMock: MockAzureMonitorService, authMock: MockAzureAuthService): void {
    // Authentication errors
    authMock.simulateAuthenticationFailure('error-client');
    authMock.simulateTokenExpired('expired-client');

    // Monitor service errors
    monitorMock.simulateAuthenticationFailure('/auth-error-endpoint');
    monitorMock.simulateRateLimitExceeded('/rate-limit-endpoint');
    monitorMock.simulateSchemaValidationError('/schema-error-endpoint');
    monitorMock.simulateServiceUnavailable('/unavailable-endpoint');
    monitorMock.simulateNetworkTimeout('/timeout-endpoint');
  }
}