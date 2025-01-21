/**
 * Mock AWS services for testing
 * Provides configurable mock implementations of S3 and KMS services
 */

import { Readable } from 'stream';
import { TestUtils } from '../utils/test-helpers';

/**
 * Mock S3 service with configurable responses
 */
export class MockS3Service {
  private objects: Map<string, any> = new Map();
  private errors: Map<string, Error> = new Map();
  private listObjectsResponse: any = null;
  private getObjectResponse: any = null;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.objects.clear();
    this.errors.clear();
    this.listObjectsResponse = null;
    this.getObjectResponse = null;
  }

  // Configuration methods
  addObject(key: string, content: string, metadata: any = {}): void {
    this.objects.set(key, {
      content,
      metadata: {
        ContentLength: Buffer.byteLength(content),
        ContentType: 'application/json',
        LastModified: new Date(),
        ETag: '"abc123def456"',
        ...metadata
      }
    });
  }

  addCompressedObject(key: string, content: string, metadata: any = {}): void {
    const compressed = TestUtils.createCompressedContent(content);
    this.objects.set(key, {
      content: compressed,
      metadata: {
        ContentLength: compressed.length,
        ContentType: 'application/gzip',
        ContentEncoding: 'gzip',
        LastModified: new Date(),
        ETag: '"compressed123"',
        ...metadata
      }
    });
  }

  setError(key: string, error: Error): void {
    this.errors.set(key, error);
  }

  setListObjectsResponse(response: any): void {
    this.listObjectsResponse = response;
  }

  setGetObjectResponse(response: any): void {
    this.getObjectResponse = response;
  }

  // Mock AWS SDK methods
  createMockS3Client(): any {
    return {
      send: jest.fn().mockImplementation((command: any) => {
        if (command.constructor.name === 'ListObjectsV2Command') {
          return this.handleListObjects(command);
        } else if (command.constructor.name === 'GetObjectCommand') {
          return this.handleGetObject(command);
        } else if (command.constructor.name === 'HeadBucketCommand') {
          return this.handleHeadBucket(command);
        }
        throw new Error(`Unsupported command: ${command.constructor.name}`);
      })
    };
  }

  private handleListObjects(command: any): any {
    if (this.listObjectsResponse) {
      return Promise.resolve(this.listObjectsResponse);
    }

    const bucket = command.input.Bucket;
    const prefix = command.input.Prefix || '';

    // Check for bucket-level errors
    if (this.errors.has(bucket)) {
      return Promise.reject(this.errors.get(bucket));
    }

    // Filter objects by prefix
    const matchingObjects = Array.from(this.objects.entries())
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, obj]) => ({
        Key: key,
        Size: obj.metadata.ContentLength,
        LastModified: obj.metadata.LastModified,
        ETag: obj.metadata.ETag,
        StorageClass: 'STANDARD'
      }));

    return Promise.resolve({
      Contents: matchingObjects,
      IsTruncated: false,
      KeyCount: matchingObjects.length,
      MaxKeys: 1000,
      Name: bucket,
      Prefix: prefix
    });
  }

  private handleGetObject(command: any): any {
    if (this.getObjectResponse) {
      return Promise.resolve(this.getObjectResponse);
    }

    const key = command.input.Key;

    // Check for key-specific errors
    if (this.errors.has(key)) {
      return Promise.reject(this.errors.get(key));
    }

    // Check if object exists
    if (!this.objects.has(key)) {
      const error = new Error('The specified key does not exist.');
      (error as any).name = 'NoSuchKey';
      return Promise.reject(error);
    }

    const obj = this.objects.get(key);
    const body = typeof obj.content === 'string' 
      ? TestUtils.createMockReadableStream(obj.content)
      : new Readable({
          read() {
            this.push(obj.content);
            this.push(null);
          }
        });

    return Promise.resolve({
      Body: body,
      ...obj.metadata
    });
  }

  private handleHeadBucket(command: any): any {
    const bucket = command.input.Bucket;

    if (this.errors.has(bucket)) {
      return Promise.reject(this.errors.get(bucket));
    }

    return Promise.resolve({});
  }

  // Helper methods for common test scenarios
  simulateAccessDenied(bucketOrKey: string): void {
    const error = new Error('Access Denied');
    (error as any).name = 'AccessDenied';
    (error as any).code = 'AccessDenied';
    this.setError(bucketOrKey, error);
  }

  simulateNoSuchBucket(bucket: string): void {
    const error = new Error('The specified bucket does not exist');
    (error as any).name = 'NoSuchBucket';
    (error as any).code = 'NoSuchBucket';
    this.setError(bucket, error);
  }

  simulateNetworkError(bucketOrKey: string): void {
    const error = new Error('Network error');
    (error as any).name = 'NetworkingError';
    (error as any).code = 'NetworkingError';
    this.setError(bucketOrKey, error);
  }

  addGuardDutyExport(bucket: string, accountId: string, region: string, findings: any[]): string {
    const key = `AWSLogs/${accountId}/GuardDuty/${region}/2024/01/01/12/${TestUtils.generateRandomString(32)}.jsonl.gz`;
    const content = findings.map(f => JSON.stringify(f)).join('\n');
    this.addCompressedObject(key, content);
    return key;
  }
}

/**
 * Mock KMS service with configurable responses
 */
export class MockKMSService {
  private decryptResponses: Map<string, Buffer> = new Map();
  private errors: Map<string, Error> = new Map();

  constructor() {
    this.reset();
  }

  reset(): void {
    this.decryptResponses.clear();
    this.errors.clear();
  }

  // Configuration methods
  setDecryptResponse(ciphertext: string, plaintext: Buffer): void {
    this.decryptResponses.set(ciphertext, plaintext);
  }

  setError(ciphertext: string, error: Error): void {
    this.errors.set(ciphertext, error);
  }

  // Mock AWS SDK methods
  createMockKMSClient(): any {
    return {
      send: jest.fn().mockImplementation((command: any) => {
        if (command.constructor.name === 'DecryptCommand') {
          return this.handleDecrypt(command);
        }
        throw new Error(`Unsupported command: ${command.constructor.name}`);
      })
    };
  }

  private handleDecrypt(command: any): any {
    const ciphertext = command.input.CiphertextBlob;
    const ciphertextKey = Buffer.from(ciphertext).toString('base64');

    // Check for errors
    if (this.errors.has(ciphertextKey)) {
      return Promise.reject(this.errors.get(ciphertextKey));
    }

    // Check for configured response
    if (this.decryptResponses.has(ciphertextKey)) {
      return Promise.resolve({
        Plaintext: this.decryptResponses.get(ciphertextKey),
        KeyId: 'arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012'
      });
    }

    // Default behavior - return the ciphertext as plaintext for testing
    return Promise.resolve({
      Plaintext: ciphertext,
      KeyId: 'arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012'
    });
  }

  // Helper methods for common test scenarios
  simulateAccessDenied(ciphertext: string): void {
    const error = new Error('Access denied');
    (error as any).name = 'AccessDeniedException';
    (error as any).code = 'AccessDeniedException';
    this.setError(ciphertext, error);
  }

  simulateInvalidCiphertext(ciphertext: string): void {
    const error = new Error('Invalid ciphertext');
    (error as any).name = 'InvalidCiphertextException';
    (error as any).code = 'InvalidCiphertextException';
    this.setError(ciphertext, error);
  }

  simulateKeyNotFound(ciphertext: string): void {
    const error = new Error('Key not found');
    (error as any).name = 'NotFoundException';
    (error as any).code = 'NotFoundException';
    this.setError(ciphertext, error);
  }
}

/**
 * Combined AWS mock factory for easy setup
 */
export class AWSMockFactory {
  static createS3Mock(): MockS3Service {
    return new MockS3Service();
  }

  static createKMSMock(): MockKMSService {
    return new MockKMSService();
  }

  static createCompleteAWSMocks(): { s3: MockS3Service; kms: MockKMSService } {
    return {
      s3: new MockS3Service(),
      kms: new MockKMSService()
    };
  }

  static setupDefaultS3Scenario(s3Mock: MockS3Service): void {
    // Add some default test objects
    s3Mock.addObject('test-object-1.json', '{"test": "data1"}');
    s3Mock.addObject('test-object-2.json', '{"test": "data2"}');
    s3Mock.addCompressedObject('compressed-object.jsonl.gz', '{"test": "compressed"}');
    
    // Add GuardDuty-like structure
    const findings = [
      { id: 'finding1', type: 'Test:Finding/Type1', severity: 5.0 },
      { id: 'finding2', type: 'Test:Finding/Type2', severity: 7.0 }
    ];
    s3Mock.addGuardDutyExport('test-bucket', '123456789012', 'us-east-1', findings);
  }

  static setupDefaultKMSScenario(kmsMock: MockKMSService): void {
    // Setup default decryption responses
    const testData = Buffer.from('decrypted test data');
    kmsMock.setDecryptResponse(Buffer.from('encrypted test data').toString('base64'), testData);
  }

  static setupErrorScenarios(s3Mock: MockS3Service, kmsMock: MockKMSService): void {
    // S3 error scenarios
    s3Mock.simulateAccessDenied('access-denied-bucket');
    s3Mock.simulateNoSuchBucket('nonexistent-bucket');
    s3Mock.simulateNetworkError('network-error-key');

    // KMS error scenarios
    kmsMock.simulateAccessDenied(Buffer.from('access-denied-data').toString('base64'));
    kmsMock.simulateInvalidCiphertext(Buffer.from('invalid-ciphertext').toString('base64'));
    kmsMock.simulateKeyNotFound(Buffer.from('key-not-found-data').toString('base64'));
  }
}