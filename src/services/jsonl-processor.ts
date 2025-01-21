/**
 * JSONLProcessor - Handles compressed GuardDuty findings in JSONL format
 * 
 * Processes JSONL (JSON Lines) files with streaming decompression for large files,
 * includes JSON validation and parsing with error recovery.
 */

import { createGunzip, createInflate } from 'zlib';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { GuardDutyFinding } from '../types/guardduty';

export interface JSONLProcessorConfig {
  maxLineLength?: number;
  skipInvalidLines?: boolean;
  validateSchema?: boolean;
  encoding?: BufferEncoding;
}

export interface ProcessingResult {
  totalLines: number;
  validFindings: number;
  invalidLines: number;
  errors: JSONLProcessingError[];
  findings: GuardDutyFinding[];
}

export interface JSONLProcessingError {
  lineNumber: number;
  line: string;
  error: string;
  timestamp: Date;
}

export interface StreamingProcessingResult {
  totalLines: number;
  validFindings: number;
  invalidLines: number;
  errors: JSONLProcessingError[];
}

export class JSONLProcessorError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly lineNumber?: number,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'JSONLProcessorError';
  }
}

export class JSONLProcessor {
  private config: Required<JSONLProcessorConfig>;

  constructor(config: JSONLProcessorConfig = {}) {
    this.config = {
      maxLineLength: config.maxLineLength || 1024 * 1024, // 1MB per line
      skipInvalidLines: config.skipInvalidLines ?? true,
      validateSchema: config.validateSchema ?? true,
      encoding: config.encoding || 'utf8'
    };
  }

  /**
   * Processes a compressed JSONL stream and returns all findings
   */
  async processCompressedStream(
    stream: Readable,
    compressionType: 'gzip' | 'deflate' | 'none' = 'gzip'
  ): Promise<ProcessingResult> {
    const findings: GuardDutyFinding[] = [];
    const errors: JSONLProcessingError[] = [];
    let totalLines = 0;
    let validFindings = 0;
    let invalidLines = 0;

    try {
      // Create decompression stream if needed
      let processingStream: Readable = stream;
      
      if (compressionType === 'gzip') {
        processingStream = stream.pipe(createGunzip());
      } else if (compressionType === 'deflate') {
        processingStream = stream.pipe(createInflate());
      }

      // Process the stream line by line
      const result = await this.processStreamLineByLine(
        processingStream,
        (finding) => {
          findings.push(finding);
          validFindings++;
        },
        (error) => {
          errors.push(error);
          invalidLines++;
        }
      );

      totalLines = result.totalLines;

      return {
        totalLines,
        validFindings,
        invalidLines,
        errors,
        findings
      };

    } catch (error) {
      throw new JSONLProcessorError(
        `Failed to process compressed stream: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'StreamProcessingError',
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Processes a JSONL stream with callback-based handling for memory efficiency
   */
  async processStreamWithCallback(
    stream: Readable,
    onFinding: (finding: GuardDutyFinding) => Promise<void> | void,
    onError?: (error: JSONLProcessingError) => Promise<void> | void,
    compressionType: 'gzip' | 'deflate' | 'none' = 'gzip'
  ): Promise<StreamingProcessingResult> {
    const errors: JSONLProcessingError[] = [];
    let totalLines = 0;
    let validFindings = 0;
    let invalidLines = 0;

    try {
      // Create decompression stream if needed
      let processingStream: Readable = stream;
      
      if (compressionType === 'gzip') {
        processingStream = stream.pipe(createGunzip());
      } else if (compressionType === 'deflate') {
        processingStream = stream.pipe(createInflate());
      }

      // Process the stream line by line
      const result = await this.processStreamLineByLine(
        processingStream,
        async (finding) => {
          await onFinding(finding);
          validFindings++;
        },
        async (error) => {
          errors.push(error);
          if (onError) {
            await onError(error);
          }
          invalidLines++;
        }
      );

      totalLines = result.totalLines;

      return {
        totalLines,
        validFindings,
        invalidLines,
        errors
      };

    } catch (error) {
      throw new JSONLProcessorError(
        `Failed to process stream with callback: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'CallbackProcessingError',
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Processes raw JSONL text content
   */
  async processText(text: string): Promise<ProcessingResult> {
    const findings: GuardDutyFinding[] = [];
    const errors: JSONLProcessingError[] = [];
    let validFindings = 0;
    let invalidLines = 0;

    const lines = text.split('\n');
    const totalLines = lines.length;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Skip empty lines
      if (!line) {
        continue;
      }

      try {
        const finding = this.parseLine(line, i + 1);
        if (finding) {
          findings.push(finding);
          validFindings++;
        }
      } catch (error) {
        const processingError: JSONLProcessingError = {
          lineNumber: i + 1,
          line: line.substring(0, 200) + (line.length > 200 ? '...' : ''),
          error: error instanceof Error ? error.message : 'Unknown parsing error',
          timestamp: new Date()
        };
        
        errors.push(processingError);
        invalidLines++;

        if (!this.config.skipInvalidLines) {
          throw new JSONLProcessorError(
            `Failed to parse line ${i + 1}: ${processingError.error}`,
            'LineParsingError',
            i + 1,
            error instanceof Error ? error : undefined
          );
        }
      }
    }

    return {
      totalLines,
      validFindings,
      invalidLines,
      errors,
      findings
    };
  }

  /**
   * Validates a GuardDuty finding against the expected schema
   */
  validateFinding(finding: any): finding is GuardDutyFinding {
    if (!this.config.validateSchema) {
      return true;
    }

    // Basic required field validation
    const requiredFields = [
      'schemaVersion', 'accountId', 'region', 'id', 'arn', 'type',
      'resource', 'service', 'severity', 'createdAt', 'updatedAt',
      'title', 'description'
    ];

    for (const field of requiredFields) {
      if (!(field in finding) || finding[field] === null || finding[field] === undefined) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Type validations
    if (typeof finding.accountId !== 'string' || !/^\d{12}$/.test(finding.accountId)) {
      throw new Error('Invalid accountId: must be 12-digit string');
    }

    if (typeof finding.severity !== 'number' || finding.severity < 0 || finding.severity > 8.9) {
      throw new Error('Invalid severity: must be number between 0 and 8.9');
    }

    if (typeof finding.resource !== 'object' || !finding.resource.resourceType) {
      throw new Error('Invalid resource: must be object with resourceType');
    }

    if (typeof finding.service !== 'object' || !finding.service.serviceName) {
      throw new Error('Invalid service: must be object with serviceName');
    }

    // Date validation
    const createdAt = new Date(finding.createdAt);
    const updatedAt = new Date(finding.updatedAt);
    
    if (isNaN(createdAt.getTime())) {
      throw new Error('Invalid createdAt: must be valid ISO date string');
    }
    
    if (isNaN(updatedAt.getTime())) {
      throw new Error('Invalid updatedAt: must be valid ISO date string');
    }

    return true;
  }

  /**
   * Gets processor configuration
   */
  getConfig(): JSONLProcessorConfig {
    return { ...this.config };
  }

  /**
   * Creates a transform stream for processing JSONL data
   */
  createTransformStream(): Transform {
    let buffer = '';
    let lineNumber = 0;
    const processor = this;

    return new Transform({
      objectMode: true,
      transform(chunk: Buffer, encoding, callback) {
        try {
          buffer += chunk.toString(processor.config.encoding);
          const lines = buffer.split('\n');
          
          // Keep the last incomplete line in buffer
          buffer = lines.pop() || '';

          for (const line of lines) {
            lineNumber++;
            const trimmedLine = line.trim();
            
            if (!trimmedLine) {
              continue;
            }

            try {
              const finding = processor.parseLine(trimmedLine, lineNumber);
              if (finding) {
                this.push({ type: 'finding', data: finding, lineNumber });
              }
            } catch (error) {
              const processingError: JSONLProcessingError = {
                lineNumber,
                line: trimmedLine.substring(0, 200) + (trimmedLine.length > 200 ? '...' : ''),
                error: error instanceof Error ? error.message : 'Unknown parsing error',
                timestamp: new Date()
              };
              
              this.push({ type: 'error', data: processingError, lineNumber });
            }
          }
          
          callback();
        } catch (error) {
          callback(error instanceof Error ? error : new Error('Transform error'));
        }
      },
      
      flush(callback) {
        // Process any remaining data in buffer
        if (buffer.trim()) {
          lineNumber++;
          try {
            const finding = processor.parseLine(buffer.trim(), lineNumber);
            if (finding) {
              this.push({ type: 'finding', data: finding, lineNumber });
            }
          } catch (error) {
            const processingError: JSONLProcessingError = {
              lineNumber,
              line: buffer.trim().substring(0, 200) + (buffer.trim().length > 200 ? '...' : ''),
              error: error instanceof Error ? error.message : 'Unknown parsing error',
              timestamp: new Date()
            };
            
            this.push({ type: 'error', data: processingError, lineNumber });
          }
        }
        callback();
      }
    });
  }

  /**
   * Private method to parse a single line
   */
  private parseLine(line: string, lineNumber: number): GuardDutyFinding | null {
    if (line.length > this.config.maxLineLength) {
      throw new Error(`Line exceeds maximum length of ${this.config.maxLineLength} characters`);
    }

    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : 'Parse error'}`);
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Parsed JSON is not an object');
    }

    // Validate the finding if schema validation is enabled
    if (this.config.validateSchema) {
      this.validateFinding(parsed);
    }

    return parsed as GuardDutyFinding;
  }

  /**
   * Private method to process stream line by line
   */
  private async processStreamLineByLine(
    stream: Readable,
    onFinding: (finding: GuardDutyFinding) => Promise<void> | void,
    onError: (error: JSONLProcessingError) => Promise<void> | void
  ): Promise<{ totalLines: number }> {
    let totalLines = 0;
    
    const transformStream = this.createTransformStream();
    
    return new Promise((resolve, reject) => {
      let hasError = false;

      transformStream.on('data', async (item) => {
        try {
          if (item.type === 'finding') {
            await onFinding(item.data);
          } else if (item.type === 'error') {
            await onError(item.data);
          }
          totalLines = Math.max(totalLines, item.lineNumber);
        } catch (error) {
          hasError = true;
          reject(error);
        }
      });

      transformStream.on('end', () => {
        if (!hasError) {
          resolve({ totalLines });
        }
      });

      transformStream.on('error', (error) => {
        hasError = true;
        reject(error);
      });

      stream.on('error', (error) => {
        hasError = true;
        reject(error);
      });

      // Pipe the stream through the transform
      stream.pipe(transformStream);
    });
  }
}