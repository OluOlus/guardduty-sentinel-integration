# GuardDuty to Sentinel Integration - Performance Tuning Guide

## Overview

This guide provides comprehensive recommendations for optimizing the performance of the GuardDuty to Sentinel integration system across different deployment scenarios and workload patterns.

## Table of Contents

1. [Performance Baselines](#performance-baselines)
2. [Batch Processing Optimization](#batch-processing-optimization)
3. [Memory Management](#memory-management)
4. [Network Optimization](#network-optimization)
5. [Scaling Strategies](#scaling-strategies)
6. [Azure Monitor Optimization](#azure-monitor-optimization)
7. [AWS S3 Optimization](#aws-s3-optimization)
8. [Container Optimization](#container-optimization)
9. [Monitoring and Profiling](#monitoring-and-profiling)
10. [Workload-Specific Tuning](#workload-specific-tuning)

## Performance Baselines

### Target Performance Metrics

| Metric | Light Load | Medium Load | Heavy Load |
|--------|------------|-------------|------------|
| **Findings Volume** | < 1,000/hour | 1,000-10,000/hour | > 10,000/hour |
| **Processing Latency** | < 2 minutes | < 3 minutes | < 5 minutes |
| **Throughput** | 500 findings/min | 2,000 findings/min | 5,000+ findings/min |
| **Error Rate** | < 0.5% | < 1% | < 2% |
| **CPU Utilization** | < 50% | < 70% | < 80% |
| **Memory Usage** | < 512MB | < 1GB | < 2GB |

### Baseline Configuration

```javascript
// Recommended starting configuration
const baselineConfig = {
  // Processing
  batchSize: 100,
  maxRetries: 3,
  retryBackoffMs: 1000,
  
  // Concurrency
  maxConcurrentBatches: 3,
  processingTimeout: 30000,
  
  // Deduplication
  deduplication: {
    enabled: true,
    strategy: 'findingId',
    cacheSize: 10000,
    timeWindowMinutes: 60
  },
  
  // Monitoring
  metricsInterval: 30000,
  healthCheckInterval: 60000
};
```

## Batch Processing Optimization

### Batch Size Tuning

#### Determining Optimal Batch Size

```bash
#!/bin/bash
# Batch size performance test script

echo "Testing batch size performance..."
for size in 25 50 100 200 500 1000; do
  echo "Testing batch size: $size"
  
  # Set batch size
  export BATCH_SIZE=$size
  
  # Run performance test
  start_time=$(date +%s)
  npm run test:performance -- --findings=1000
  end_time=$(date +%s)
  
  duration=$((end_time - start_time))
  throughput=$((1000 / duration))
  
  echo "Batch size $size: ${duration}s, ${throughput} findings/sec"
done
```

#### Batch Size Guidelines by Deployment Type

| Deployment Type | Optimal Range | Max Recommended | Considerations |
|----------------|---------------|-----------------|----------------|
| **AWS Lambda** | 25-100 | 200 | Memory limits, timeout constraints |
| **Azure Functions** | 50-200 | 500 | Consumption plan limits |
| **Container (Small)** | 100-300 | 500 | Resource constraints |
| **Container (Large)** | 200-1000 | 2000 | High throughput scenarios |

#### Dynamic Batch Sizing

```javascript
class AdaptiveBatchProcessor {
  constructor() {
    this.currentBatchSize = 100;
    this.minBatchSize = 25;
    this.maxBatchSize = 500;
    this.performanceHistory = [];
  }
  
  adjustBatchSize(processingTime, errorRate) {
    const performance = {
      batchSize: this.currentBatchSize,
      processingTime,
      errorRate,
      throughput: this.currentBatchSize / (processingTime / 1000)
    };
    
    this.performanceHistory.push(performance);
    
    // Keep last 10 measurements
    if (this.performanceHistory.length > 10) {
      this.performanceHistory.shift();
    }
    
    // Adjust based on performance
    if (errorRate > 0.05) { // > 5% error rate
      this.currentBatchSize = Math.max(
        this.minBatchSize,
        Math.floor(this.currentBatchSize * 0.8)
      );
    } else if (processingTime < 10000 && errorRate < 0.01) { // < 10s, < 1% error
      this.currentBatchSize = Math.min(
        this.maxBatchSize,
        Math.floor(this.currentBatchSize * 1.2)
      );
    }
    
    return this.currentBatchSize;
  }
}
```

### Parallel Processing

#### Concurrent Batch Processing

```javascript
class ConcurrentBatchProcessor {
  constructor(config) {
    this.maxConcurrency = config.maxConcurrentBatches || 3;
    this.activeBatches = new Set();
    this.queue = [];
  }
  
  async processBatches(batches) {
    const results = [];
    
    // Process batches with controlled concurrency
    for (let i = 0; i < batches.length; i += this.maxConcurrency) {
      const chunk = batches.slice(i, i + this.maxConcurrency);
      const chunkResults = await Promise.allSettled(
        chunk.map(batch => this.processBatch(batch))
      );
      results.push(...chunkResults);
    }
    
    return results;
  }
  
  async processBatch(batch) {
    const batchId = `batch-${Date.now()}-${Math.random()}`;
    this.activeBatches.add(batchId);
    
    try {
      const startTime = Date.now();
      const result = await this.processFindings(batch.findings);
      const duration = Date.now() - startTime;
      
      this.recordMetrics(batch.findings.length, duration, 0);
      return result;
    } catch (error) {
      this.recordMetrics(batch.findings.length, 0, 1);
      throw error;
    } finally {
      this.activeBatches.delete(batchId);
    }
  }
}
```

## Memory Management

### Memory Usage Patterns

#### Monitoring Memory Usage

```javascript
class MemoryMonitor {
  constructor() {
    this.memoryHistory = [];
    this.gcHistory = [];
    
    // Monitor GC events
    if (global.gc) {
      setInterval(() => {
        const before = process.memoryUsage();
        global.gc();
        const after = process.memoryUsage();
        
        this.gcHistory.push({
          timestamp: Date.now(),
          before,
          after,
          freed: before.heapUsed - after.heapUsed
        });
      }, 60000); // Every minute
    }
  }
  
  recordMemoryUsage() {
    const usage = process.memoryUsage();
    this.memoryHistory.push({
      timestamp: Date.now(),
      ...usage,
      heapUsedMB: Math.round(usage.heapUsed / 1024 / 1024),
      rssMB: Math.round(usage.rss / 1024 / 1024)
    });
    
    // Keep last 100 measurements
    if (this.memoryHistory.length > 100) {
      this.memoryHistory.shift();
    }
    
    return usage;
  }
  
  detectMemoryLeak() {
    if (this.memoryHistory.length < 10) return false;
    
    const recent = this.memoryHistory.slice(-10);
    const trend = this.calculateTrend(recent.map(m => m.heapUsedMB));
    
    // Memory leak if consistent upward trend > 10MB/measurement
    return trend > 10;
  }
  
  calculateTrend(values) {
    const n = values.length;
    const sumX = (n * (n - 1)) / 2;
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = values.reduce((sum, y, x) => sum + x * y, 0);
    const sumX2 = values.reduce((sum, _, x) => sum + x * x, 0);
    
    return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  }
}
```

#### Memory Optimization Strategies

1. **Streaming Processing**

```javascript
class StreamingProcessor {
  async processLargeFile(filePath) {
    const stream = fs.createReadStream(filePath)
      .pipe(zlib.createGunzip())
      .pipe(split('\n'));
    
    let batch = [];
    const batchSize = 100;
    
    for await (const line of stream) {
      if (line.trim()) {
        batch.push(JSON.parse(line));
        
        if (batch.length >= batchSize) {
          await this.processBatch(batch);
          batch = []; // Clear batch to free memory
        }
      }
    }
    
    // Process remaining items
    if (batch.length > 0) {
      await this.processBatch(batch);
    }
  }
}
```

2. **Object Pool Pattern**

```javascript
class FindingObjectPool {
  constructor(size = 1000) {
    this.pool = [];
    this.size = size;
    
    // Pre-allocate objects
    for (let i = 0; i < size; i++) {
      this.pool.push(this.createFinding());
    }
  }
  
  acquire() {
    return this.pool.pop() || this.createFinding();
  }
  
  release(finding) {
    if (this.pool.length < this.size) {
      this.resetFinding(finding);
      this.pool.push(finding);
    }
  }
  
  createFinding() {
    return {
      id: null,
      type: null,
      severity: null,
      timestamp: null,
      data: {}
    };
  }
  
  resetFinding(finding) {
    finding.id = null;
    finding.type = null;
    finding.severity = null;
    finding.timestamp = null;
    finding.data = {};
  }
}
```

### Garbage Collection Tuning

#### Node.js GC Options

```bash
# Optimize for throughput
node --max-old-space-size=2048 \
     --gc-interval=100 \
     --optimize-for-size \
     dist/index.js

# Optimize for low latency
node --max-old-space-size=1024 \
     --gc-interval=50 \
     --expose-gc \
     dist/index.js
```

#### Container Memory Limits

```yaml
# Kubernetes resource limits
resources:
  limits:
    memory: "2Gi"
  requests:
    memory: "1Gi"

# Docker memory limits
docker run -m 2g --oom-kill-disable guardduty-integration
```

## Network Optimization

### Connection Pooling

#### HTTP Client Optimization

```javascript
class OptimizedHttpClient {
  constructor(config) {
    this.agent = new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 50,
      maxFreeSockets: 10,
      timeout: 30000,
      freeSocketTimeout: 15000
    });
    
    this.client = axios.create({
      httpsAgent: this.agent,
      timeout: config.timeout || 30000,
      maxRedirects: 3,
      validateStatus: (status) => status < 500
    });
  }
  
  async makeRequest(config) {
    const startTime = Date.now();
    
    try {
      const response = await this.client.request(config);
      const duration = Date.now() - startTime;
      
      this.recordMetrics('http_request_success', duration);
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordMetrics('http_request_error', duration);
      throw error;
    }
  }
}
```

#### Azure Monitor Client Optimization

```javascript
class OptimizedAzureClient {
  constructor(config) {
    this.config = config;
    this.tokenCache = new Map();
    this.requestQueue = [];
    this.rateLimiter = new RateLimiter(100, 60000); // 100 requests per minute
  }
  
  async ingestData(data) {
    // Rate limiting
    await this.rateLimiter.acquire();
    
    // Batch multiple requests
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ data, resolve, reject });
      
      if (this.requestQueue.length >= 10) {
        this.flushQueue();
      } else {
        // Flush after delay if queue not full
        setTimeout(() => this.flushQueue(), 1000);
      }
    });
  }
  
  async flushQueue() {
    if (this.requestQueue.length === 0) return;
    
    const batch = this.requestQueue.splice(0, 10);
    const combinedData = batch.flatMap(item => item.data);
    
    try {
      const result = await this.sendBatch(combinedData);
      batch.forEach(item => item.resolve(result));
    } catch (error) {
      batch.forEach(item => item.reject(error));
    }
  }
}
```

### DNS Optimization

```javascript
// DNS caching
const dns = require('dns');
const dnsCache = new Map();

dns.lookup = ((originalLookup) => {
  return (hostname, options, callback) => {
    const key = `${hostname}:${JSON.stringify(options)}`;
    
    if (dnsCache.has(key)) {
      const cached = dnsCache.get(key);
      if (Date.now() - cached.timestamp < 300000) { // 5 minutes
        return callback(null, cached.address, cached.family);
      }
    }
    
    originalLookup(hostname, options, (err, address, family) => {
      if (!err) {
        dnsCache.set(key, { address, family, timestamp: Date.now() });
      }
      callback(err, address, family);
    });
  };
})(dns.lookup);
```

## Scaling Strategies

### Horizontal Scaling

#### Auto-scaling Configuration

```yaml
# Kubernetes HPA with custom metrics
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: guardduty-integration
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: guardduty-integration
  minReplicas: 2
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Pods
    pods:
      metric:
        name: findings_queue_depth
      target:
        type: AverageValue
        averageValue: "100"
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
      - type: Percent
        value: 100
        periodSeconds: 15
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
      - type: Percent
        value: 10
        periodSeconds: 60
```

#### Load Balancing Strategies

```javascript
class LoadBalancer {
  constructor(workers) {
    this.workers = workers;
    this.currentIndex = 0;
    this.healthStatus = new Map();
    
    // Health check workers
    setInterval(() => this.checkWorkerHealth(), 30000);
  }
  
  getNextWorker() {
    const healthyWorkers = this.workers.filter(w => 
      this.healthStatus.get(w.id) !== 'unhealthy'
    );
    
    if (healthyWorkers.length === 0) {
      throw new Error('No healthy workers available');
    }
    
    // Round-robin with health awareness
    const worker = healthyWorkers[this.currentIndex % healthyWorkers.length];
    this.currentIndex++;
    
    return worker;
  }
  
  async checkWorkerHealth() {
    for (const worker of this.workers) {
      try {
        const response = await fetch(`${worker.url}/health`);
        const health = await response.json();
        this.healthStatus.set(worker.id, health.status);
      } catch (error) {
        this.healthStatus.set(worker.id, 'unhealthy');
      }
    }
  }
}
```

### Vertical Scaling

#### Resource Allocation Guidelines

```javascript
class ResourceCalculator {
  static calculateResources(findingsPerHour) {
    const baseMemory = 512; // MB
    const baseCpu = 0.5; // cores
    
    // Scale based on findings volume
    const memoryMultiplier = Math.max(1, findingsPerHour / 1000);
    const cpuMultiplier = Math.max(1, findingsPerHour / 2000);
    
    return {
      memory: Math.min(8192, baseMemory * memoryMultiplier), // Max 8GB
      cpu: Math.min(4, baseCpu * cpuMultiplier), // Max 4 cores
      replicas: Math.max(1, Math.ceil(findingsPerHour / 5000)) // Scale out at 5k/hour
    };
  }
  
  static getRecommendedLimits(workloadType) {
    const profiles = {
      light: { memory: '1Gi', cpu: '500m', replicas: 1 },
      medium: { memory: '2Gi', cpu: '1000m', replicas: 2 },
      heavy: { memory: '4Gi', cpu: '2000m', replicas: 4 },
      extreme: { memory: '8Gi', cpu: '4000m', replicas: 8 }
    };
    
    return profiles[workloadType] || profiles.medium;
  }
}
```

## Azure Monitor Optimization

### DCR Configuration Optimization

```json
{
  "properties": {
    "streamDeclarations": {
      "Custom-GuardDutyFindings": {
        "columns": [
          {"name": "TimeGenerated", "type": "datetime"},
          {"name": "FindingId", "type": "string"},
          {"name": "AccountId", "type": "string"},
          {"name": "Region", "type": "string"},
          {"name": "Severity", "type": "real"},
          {"name": "Type", "type": "string"},
          {"name": "RawJson", "type": "string"}
        ]
      }
    },
    "dataFlows": [{
      "streams": ["Custom-GuardDutyFindings"],
      "destinations": ["LogAnalyticsDest"],
      "transformKql": "source | extend TimeGenerated = todatetime(TimeGenerated) | where isnotnull(FindingId)",
      "outputStream": "Custom-RawGuardDuty_CL"
    }]
  }
}
```

### Query Optimization

```kql
// Optimized query patterns
.create function GuardDutyNormalizedOptimized() {
  RawGuardDuty_CL
  | where TimeGenerated > ago(7d)  // Always filter by time first
  | where isnotempty(RawJson)      // Filter out empty records
  | extend ParsedJson = parse_json(RawJson)
  | where isnotnull(ParsedJson)    // Filter parsing failures
  | project 
    TimeGenerated,
    FindingId,
    AccountId,
    Region,
    Severity,
    Type,
    // Extract only needed fields to reduce memory
    Title = tostring(ParsedJson.title),
    Description = tostring(ParsedJson.description),
    Service = tostring(ParsedJson.service.serviceName)
  | where isnotempty(FindingId)    // Final validation
}

// Materialized view for better performance
.create materialized-view GuardDutyMaterialized on table RawGuardDuty_CL {
  RawGuardDuty_CL
  | where TimeGenerated > ago(30d)
  | extend ParsedJson = parse_json(RawJson)
  | project 
    TimeGenerated,
    FindingId,
    AccountId,
    Region,
    Severity = todouble(Severity),
    Type,
    Title = tostring(ParsedJson.title)
}
```

## AWS S3 Optimization

### S3 Client Configuration

```javascript
class OptimizedS3Client {
  constructor(config) {
    this.client = new S3Client({
      region: config.region,
      maxAttempts: 3,
      retryMode: 'adaptive',
      requestHandler: {
        connectionTimeout: 5000,
        socketTimeout: 30000,
        httpHandler: {
          connectionTimeout: 5000,
          socketTimeout: 30000,
          maxConnections: 50
        }
      }
    });
    
    // Connection pooling
    this.connectionPool = new Map();
  }
  
  async getObjectOptimized(bucket, key) {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      // Use byte range for large objects
      Range: this.shouldUseRange(key) ? 'bytes=0-1048576' : undefined
    });
    
    return this.client.send(command);
  }
  
  shouldUseRange(key) {
    // Use range requests for files > 10MB
    return key.includes('large') || key.endsWith('.gz');
  }
}
```

### Parallel S3 Processing

```javascript
class ParallelS3Processor {
  constructor(config) {
    this.concurrency = config.s3Concurrency || 10;
    this.semaphore = new Semaphore(this.concurrency);
  }
  
  async processS3Objects(objects) {
    const results = await Promise.allSettled(
      objects.map(obj => this.processWithSemaphore(obj))
    );
    
    return results;
  }
  
  async processWithSemaphore(s3Object) {
    await this.semaphore.acquire();
    
    try {
      return await this.processS3Object(s3Object);
    } finally {
      this.semaphore.release();
    }
  }
  
  async processS3Object(s3Object) {
    // Stream processing for large files
    if (s3Object.size > 10 * 1024 * 1024) { // > 10MB
      return this.processLargeObject(s3Object);
    } else {
      return this.processSmallObject(s3Object);
    }
  }
}
```

## Container Optimization

### Docker Image Optimization

```dockerfile
# Multi-stage build for smaller images
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force
COPY . .
RUN npm run build

FROM node:18-alpine AS production
RUN apk add --no-cache dumb-init
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
```

### Resource Limits and Requests

```yaml
# Optimized resource configuration
resources:
  limits:
    memory: "2Gi"
    cpu: "1000m"
    ephemeral-storage: "1Gi"
  requests:
    memory: "1Gi"
    cpu: "500m"
    ephemeral-storage: "500Mi"

# Quality of Service
priorityClassName: high-priority

# Node affinity for performance
affinity:
  nodeAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      nodeSelectorTerms:
      - matchExpressions:
        - key: node-type
          operator: In
          values:
          - compute-optimized
```

## Monitoring and Profiling

### Performance Metrics Collection

```javascript
class PerformanceCollector {
  constructor() {
    this.metrics = new Map();
    this.startTimes = new Map();
  }
  
  startTimer(operation) {
    const id = `${operation}-${Date.now()}-${Math.random()}`;
    this.startTimes.set(id, process.hrtime.bigint());
    return id;
  }
  
  endTimer(id, operation) {
    const startTime = this.startTimes.get(id);
    if (!startTime) return;
    
    const duration = Number(process.hrtime.bigint() - startTime) / 1000000; // Convert to ms
    this.recordMetric(operation, duration);
    this.startTimes.delete(id);
    
    return duration;
  }
  
  recordMetric(name, value, labels = {}) {
    const key = `${name}:${JSON.stringify(labels)}`;
    
    if (!this.metrics.has(key)) {
      this.metrics.set(key, {
        count: 0,
        sum: 0,
        min: Infinity,
        max: -Infinity,
        values: []
      });
    }
    
    const metric = this.metrics.get(key);
    metric.count++;
    metric.sum += value;
    metric.min = Math.min(metric.min, value);
    metric.max = Math.max(metric.max, value);
    metric.values.push(value);
    
    // Keep only last 100 values for percentile calculation
    if (metric.values.length > 100) {
      metric.values.shift();
    }
  }
  
  getPercentile(name, percentile) {
    const key = Object.keys(this.metrics).find(k => k.startsWith(name));
    if (!key) return null;
    
    const values = this.metrics.get(key).values.sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * values.length) - 1;
    return values[index];
  }
}
```

### Continuous Profiling

```javascript
// CPU profiling
const profiler = require('v8-profiler-next');

class ContinuousProfiler {
  constructor(config) {
    this.profilingInterval = config.profilingInterval || 300000; // 5 minutes
    this.profileDuration = config.profileDuration || 30000; // 30 seconds
    this.isEnabled = config.enableProfiling || false;
  }
  
  start() {
    if (!this.isEnabled) return;
    
    setInterval(() => {
      this.captureProfile();
    }, this.profilingInterval);
  }
  
  async captureProfile() {
    const title = `profile-${Date.now()}`;
    
    // Start CPU profiling
    profiler.startProfiling(title, true);
    
    setTimeout(() => {
      const profile = profiler.stopProfiling(title);
      
      // Save profile to file or send to monitoring system
      profile.export((error, result) => {
        if (!error) {
          fs.writeFileSync(`./profiles/${title}.cpuprofile`, result);
        }
        profile.delete();
      });
    }, this.profileDuration);
  }
}
```

## Workload-Specific Tuning

### High-Volume Workloads

```javascript
// Configuration for high-volume scenarios (>10k findings/hour)
const highVolumeConfig = {
  batchSize: 500,
  maxConcurrentBatches: 10,
  deduplication: {
    enabled: true,
    strategy: 'contentHash', // More efficient for high volume
    cacheSize: 50000,
    timeWindowMinutes: 30
  },
  networking: {
    maxConnections: 100,
    keepAlive: true,
    timeout: 60000
  },
  memory: {
    maxOldSpaceSize: 4096,
    gcInterval: 50
  }
};
```

### Low-Latency Workloads

```javascript
// Configuration for low-latency scenarios
const lowLatencyConfig = {
  batchSize: 25,
  maxConcurrentBatches: 2,
  processingTimeout: 5000,
  deduplication: {
    enabled: false // Disable for lowest latency
  },
  networking: {
    timeout: 10000,
    retries: 1
  },
  memory: {
    maxOldSpaceSize: 1024,
    gcInterval: 25
  }
};
```

### Cost-Optimized Workloads

```javascript
// Configuration for cost optimization
const costOptimizedConfig = {
  batchSize: 200,
  maxConcurrentBatches: 1,
  deduplication: {
    enabled: true,
    strategy: 'findingId',
    cacheSize: 5000
  },
  scheduling: {
    // Process during off-peak hours
    preferredHours: [2, 3, 4, 5, 6], // 2 AM - 6 AM
    batchingDelay: 300000 // 5 minutes
  }
};
```

For implementation examples and advanced optimization techniques, see the [Operations Guide](operations-guide.md).