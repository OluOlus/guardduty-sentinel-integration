/**
 * S3Service - AWS S3 client wrapper with KMS decryption support
 *
 * Provides secure access to S3 objects with automatic KMS decryption
 * for GuardDuty findings stored in encrypted S3 buckets.
 */

import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
  GetObjectCommandInput,
  ListObjectsV2CommandInput,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { KMSClient, DecryptCommand, KMSServiceException } from '@aws-sdk/client-kms';
import { Readable } from 'stream';

export interface S3ServiceConfig {
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  kmsKeyId?: string;
}

export interface S3Object {
  key: string;
  bucket: string;
  size: number;
  lastModified: Date;
  etag: string;
}

export interface S3GetObjectResult {
  body: Readable;
  contentLength: number;
  contentType?: string;
  lastModified?: Date;
  metadata?: Record<string, string>;
}

export class S3ServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'S3ServiceError';
  }
}

export class S3Service {
  private s3Client: S3Client;
  private kmsClient: KMSClient;
  private config: S3ServiceConfig;

  constructor(config: S3ServiceConfig) {
    this.config = config;

    const clientConfig = {
      region: config.region,
      ...(config.accessKeyId &&
        config.secretAccessKey && {
          credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
            ...(config.sessionToken && { sessionToken: config.sessionToken }),
          },
        }),
    };

    this.s3Client = new S3Client(clientConfig);
    this.kmsClient = new KMSClient(clientConfig);
  }

  /**
   * Lists objects in an S3 bucket with optional prefix filtering
   */
  async listObjects(bucket: string, prefix?: string, maxKeys?: number): Promise<S3Object[]> {
    try {
      const input: ListObjectsV2CommandInput = {
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: maxKeys,
      };

      const command = new ListObjectsV2Command(input);
      const response = await this.s3Client.send(command);

      if (!response.Contents) {
        return [];
      }

      return response.Contents.filter(
        (obj) => obj.Key && obj.Size !== undefined && obj.LastModified
      ).map((obj) => ({
        key: obj.Key!,
        bucket,
        size: obj.Size!,
        lastModified: obj.LastModified!,
        etag: obj.ETag || '',
      }));
    } catch (error) {
      if (error instanceof S3ServiceException) {
        throw new S3ServiceError(
          `Failed to list objects in bucket ${bucket}: ${error.message}`,
          error.name,
          error.$metadata?.httpStatusCode,
          error
        );
      }
      // Handle regular Error objects that might have AWS error names
      if (error instanceof Error) {
        if (error.name === 'AccessDenied') {
          throw new S3ServiceError(
            `Failed to list objects in bucket ${bucket}: ${error.message}`,
            error.name,
            403,
            error
          );
        }
      }
      throw new S3ServiceError(
        `Unexpected error listing objects in bucket ${bucket}`,
        'UnknownError',
        undefined,
        error as Error
      );
    }
  }

  /**
   * Gets an object from S3 with automatic KMS decryption if needed
   */
  async getObject(bucket: string, key: string): Promise<S3GetObjectResult> {
    try {
      const input: GetObjectCommandInput = {
        Bucket: bucket,
        Key: key,
      };

      const command = new GetObjectCommand(input);
      const response = await this.s3Client.send(command);

      if (!response.Body) {
        throw new S3ServiceError(`Object ${key} in bucket ${bucket} has no body`, 'NoObjectBody');
      }

      // Convert the response body to a readable stream
      const body = response.Body as Readable;

      return {
        body,
        contentLength: response.ContentLength || 0,
        contentType: response.ContentType,
        lastModified: response.LastModified,
        metadata: response.Metadata,
      };
    } catch (error) {
      if (error instanceof S3ServiceException) {
        // Handle specific S3 errors
        if (error.name === 'NoSuchKey') {
          throw new S3ServiceError(
            `Object ${key} not found in bucket ${bucket}`,
            'ObjectNotFound',
            404,
            error
          );
        }
        if (error.name === 'AccessDenied') {
          throw new S3ServiceError(
            `Access denied to object ${key} in bucket ${bucket}. Check IAM permissions.`,
            'AccessDenied',
            403,
            error
          );
        }
        throw new S3ServiceError(
          `Failed to get object ${key} from bucket ${bucket}: ${error.message}`,
          error.name,
          error.$metadata?.httpStatusCode,
          error
        );
      }
      // Handle regular Error objects that might have AWS error names
      if (error instanceof Error) {
        if (error.name === 'NoSuchKey') {
          throw new S3ServiceError(
            `Object ${key} not found in bucket ${bucket}`,
            'ObjectNotFound',
            404,
            error
          );
        }
        if (error.name === 'AccessDenied') {
          throw new S3ServiceError(
            `Access denied to object ${key} in bucket ${bucket}. Check IAM permissions.`,
            'AccessDenied',
            403,
            error
          );
        }
      }
      throw new S3ServiceError(
        `Unexpected error getting object ${key} from bucket ${bucket}`,
        'UnknownError',
        undefined,
        error as Error
      );
    }
  }

  /**
   * Decrypts KMS-encrypted data
   */
  async decryptData(encryptedData: Buffer, keyId?: string): Promise<Buffer> {
    try {
      const command = new DecryptCommand({
        CiphertextBlob: encryptedData,
        ...(keyId && { KeyId: keyId }),
      });

      const response = await this.kmsClient.send(command);

      if (!response.Plaintext) {
        throw new S3ServiceError('KMS decryption returned no plaintext data', 'DecryptionFailed');
      }

      return Buffer.from(response.Plaintext);
    } catch (error) {
      if (error instanceof KMSServiceException) {
        if (error.name === 'AccessDeniedException') {
          throw new S3ServiceError(
            `Access denied for KMS key ${keyId || 'default'}. Check KMS permissions.`,
            'KMSAccessDenied',
            403,
            error
          );
        }
        if (error.name === 'InvalidCiphertextException') {
          throw new S3ServiceError(
            'Invalid ciphertext provided for KMS decryption',
            'InvalidCiphertext',
            400,
            error
          );
        }
        throw new S3ServiceError(
          `KMS decryption failed: ${error.message}`,
          error.name,
          error.$metadata?.httpStatusCode,
          error
        );
      }
      // Handle regular Error objects that might have AWS error names
      if (error instanceof Error) {
        if (error.name === 'AccessDeniedException') {
          throw new S3ServiceError(
            `Access denied for KMS key ${keyId || 'default'}. Check KMS permissions.`,
            'KMSAccessDenied',
            403,
            error
          );
        }
        if (error.name === 'InvalidCiphertextException') {
          throw new S3ServiceError(
            'Invalid ciphertext provided for KMS decryption',
            'InvalidCiphertext',
            400,
            error
          );
        }
      }
      throw new S3ServiceError(
        'Unexpected error during KMS decryption',
        'UnknownDecryptionError',
        undefined,
        error as Error
      );
    }
  }

  /**
   * Gets and decrypts an S3 object in one operation
   */
  async getAndDecryptObject(
    bucket: string,
    key: string,
    kmsKeyId?: string
  ): Promise<S3GetObjectResult> {
    try {
      const result = await this.getObject(bucket, key);

      // Check if the object appears to be encrypted (this is a heuristic)
      // In practice, you might have metadata or other indicators
      const chunks: Buffer[] = [];

      return new Promise((resolve, reject) => {
        result.body.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        result.body.on('end', async () => {
          try {
            const data = Buffer.concat(chunks);

            // Try to decrypt if KMS key is provided or if data appears encrypted
            if (kmsKeyId || this.config.kmsKeyId) {
              try {
                const decryptedData = await this.decryptData(
                  data,
                  kmsKeyId || this.config.kmsKeyId
                );

                // Create a new readable stream from decrypted data
                const decryptedStream = new Readable({
                  read() {
                    this.push(decryptedData);
                    this.push(null);
                  },
                });

                resolve({
                  ...result,
                  body: decryptedStream,
                  contentLength: decryptedData.length,
                });
              } catch (decryptError) {
                // If decryption fails, return original data (might not be encrypted)
                const originalStream = new Readable({
                  read() {
                    this.push(data);
                    this.push(null);
                  },
                });

                resolve({
                  ...result,
                  body: originalStream,
                  contentLength: data.length,
                });
              }
            } else {
              // No KMS key provided, return original data
              const originalStream = new Readable({
                read() {
                  this.push(data);
                  this.push(null);
                },
              });

              resolve({
                ...result,
                body: originalStream,
                contentLength: data.length,
              });
            }
          } catch (error) {
            reject(error);
          }
        });

        result.body.on('error', reject);
      });
    } catch (error) {
      throw error; // Re-throw S3ServiceError or other errors
    }
  }

  /**
   * Checks if the service can access a specific bucket
   */
  async testBucketAccess(bucket: string): Promise<boolean> {
    try {
      await this.listObjects(bucket, undefined, 1);
      return true;
    } catch (error) {
      if (error instanceof S3ServiceError && error.code === 'AccessDenied') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Gets service configuration (without sensitive data)
   */
  getConfig(): Omit<S3ServiceConfig, 'accessKeyId' | 'secretAccessKey' | 'sessionToken'> {
    return {
      region: this.config.region,
      kmsKeyId: this.config.kmsKeyId,
    };
  }
}
