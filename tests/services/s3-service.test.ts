/**
 * Unit tests for S3Service
 */

import { S3Service, S3ServiceError } from '../../src/services/s3-service';
import { Readable } from 'stream';

// Mock AWS SDK
jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/client-kms');

import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { KMSClient, DecryptCommand } from '@aws-sdk/client-kms';

const mockS3Client = S3Client as jest.MockedClass<typeof S3Client>;
const mockKMSClient = KMSClient as jest.MockedClass<typeof KMSClient>;

describe('S3Service', () => {
  let s3Service: S3Service;
  let mockS3Send: jest.Mock;
  let mockKMSSend: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockS3Send = jest.fn();
    mockKMSSend = jest.fn();
    
    mockS3Client.prototype.send = mockS3Send;
    mockKMSClient.prototype.send = mockKMSSend;

    s3Service = new S3Service({
      region: 'us-east-1',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret'
    });
  });

  describe('constructor', () => {
    it('should create S3Service with valid configuration', () => {
      expect(s3Service).toBeInstanceOf(S3Service);
      expect(s3Service.getConfig()).toEqual({
        region: 'us-east-1',
        kmsKeyId: undefined
      });
    });

    it('should create S3Service with KMS key configuration', () => {
      const serviceWithKMS = new S3Service({
        region: 'us-west-2',
        kmsKeyId: 'arn:aws:kms:us-west-2:123456789012:key/12345678-1234-1234-1234-123456789012'
      });

      expect(serviceWithKMS.getConfig()).toEqual({
        region: 'us-west-2',
        kmsKeyId: 'arn:aws:kms:us-west-2:123456789012:key/12345678-1234-1234-1234-123456789012'
      });
    });
  });

  describe('listObjects', () => {
    it('should list objects successfully', async () => {
      const mockResponse = {
        Contents: [
          {
            Key: 'test-file-1.jsonl.gz',
            Size: 1024,
            LastModified: new Date('2024-01-01T00:00:00Z'),
            ETag: '"abc123"'
          },
          {
            Key: 'test-file-2.jsonl.gz',
            Size: 2048,
            LastModified: new Date('2024-01-02T00:00:00Z'),
            ETag: '"def456"'
          }
        ]
      };

      mockS3Send.mockResolvedValue(mockResponse);

      const result = await s3Service.listObjects('test-bucket', 'prefix/');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        key: 'test-file-1.jsonl.gz',
        bucket: 'test-bucket',
        size: 1024,
        lastModified: new Date('2024-01-01T00:00:00Z'),
        etag: '"abc123"'
      });
      expect(mockS3Send).toHaveBeenCalledWith(expect.any(ListObjectsV2Command));
    });

    it('should return empty array when no objects found', async () => {
      mockS3Send.mockResolvedValue({ Contents: undefined });

      const result = await s3Service.listObjects('test-bucket');

      expect(result).toEqual([]);
    });

    it('should handle S3 errors properly', async () => {
      const s3Error = new Error('Access Denied');
      s3Error.name = 'AccessDenied';
      mockS3Send.mockRejectedValue(s3Error);

      await expect(s3Service.listObjects('test-bucket')).rejects.toThrow(S3ServiceError);
    });
  });

  describe('getObject', () => {
    it('should get object successfully', async () => {
      const mockBody = new Readable({
        read() {
          this.push('test content');
          this.push(null);
        }
      });

      const mockResponse = {
        Body: mockBody,
        ContentLength: 12,
        ContentType: 'application/json',
        LastModified: new Date('2024-01-01T00:00:00Z'),
        Metadata: { 'custom-key': 'custom-value' }
      };

      mockS3Send.mockResolvedValue(mockResponse);

      const result = await s3Service.getObject('test-bucket', 'test-key');

      expect(result.body).toBe(mockBody);
      expect(result.contentLength).toBe(12);
      expect(result.contentType).toBe('application/json');
      expect(mockS3Send).toHaveBeenCalledWith(expect.any(GetObjectCommand));
    });

    it('should handle object not found error', async () => {
      const s3Error = new Error('The specified key does not exist.');
      s3Error.name = 'NoSuchKey';
      mockS3Send.mockRejectedValue(s3Error);

      await expect(s3Service.getObject('test-bucket', 'nonexistent-key'))
        .rejects.toThrow('Object nonexistent-key not found in bucket test-bucket');
    });

    it('should handle access denied error', async () => {
      const s3Error = new Error('Access Denied');
      s3Error.name = 'AccessDenied';
      mockS3Send.mockRejectedValue(s3Error);

      await expect(s3Service.getObject('test-bucket', 'test-key'))
        .rejects.toThrow('Access denied to object test-key in bucket test-bucket');
    });
  });

  describe('decryptData', () => {
    it('should decrypt data successfully', async () => {
      const plaintext = Buffer.from('decrypted content');
      const mockResponse = { Plaintext: plaintext };

      mockKMSSend.mockResolvedValue(mockResponse);

      const encryptedData = Buffer.from('encrypted content');
      const result = await s3Service.decryptData(encryptedData, 'test-key-id');

      expect(result).toEqual(plaintext);
      expect(mockKMSSend).toHaveBeenCalledWith(expect.any(DecryptCommand));
    });

    it('should handle KMS access denied error', async () => {
      const kmsError = new Error('Access denied');
      kmsError.name = 'AccessDeniedException';
      mockKMSSend.mockRejectedValue(kmsError);

      const encryptedData = Buffer.from('encrypted content');
      
      await expect(s3Service.decryptData(encryptedData, 'test-key-id'))
        .rejects.toThrow('Access denied for KMS key test-key-id');
    });

    it('should handle invalid ciphertext error', async () => {
      const kmsError = new Error('Invalid ciphertext');
      kmsError.name = 'InvalidCiphertextException';
      mockKMSSend.mockRejectedValue(kmsError);

      const encryptedData = Buffer.from('invalid encrypted content');
      
      await expect(s3Service.decryptData(encryptedData))
        .rejects.toThrow('Invalid ciphertext provided for KMS decryption');
    });
  });

  describe('testBucketAccess', () => {
    it('should return true for accessible bucket', async () => {
      mockS3Send.mockResolvedValue({ Contents: [] });

      const result = await s3Service.testBucketAccess('test-bucket');

      expect(result).toBe(true);
    });

    it('should return false for access denied', async () => {
      const s3Error = new Error('Access denied');
      s3Error.name = 'AccessDenied';
      mockS3Send.mockRejectedValue(s3Error);

      const result = await s3Service.testBucketAccess('test-bucket');

      expect(result).toBe(false);
    });

    it('should throw other errors', async () => {
      const s3Error = new Error('Unknown error');
      s3Error.name = 'UnknownError';
      mockS3Send.mockRejectedValue(s3Error);

      await expect(s3Service.testBucketAccess('test-bucket')).rejects.toThrow('Unexpected error listing objects in bucket test-bucket');
    });
  });
});