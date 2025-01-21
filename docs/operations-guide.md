# GuardDuty to Sentinel Integration - Operations Guide

## Overview

This guide provides comprehensive operational procedures for managing, monitoring, and troubleshooting the GuardDuty to Sentinel integration system in production environments.

## Table of Contents

1. [System Monitoring](#system-monitoring)
2. [Performance Tuning](#performance-tuning)
3. [Scaling Recommendations](#scaling-recommendations)
4. [Troubleshooting](#troubleshooting)
5. [Maintenance Procedures](#maintenance-procedures)
6. [Incident Response](#incident-response)
7. [Backup and Recovery](#backup-and-recovery)
8. [Security Operations](#security-operations)

## System Monitoring

### Key Metrics to Monitor

#### Application Metrics

| Metric | Description | Threshold | Action |
|--------|-------------|-----------|--------|
| `findings_processed_total` | Total findings processed | - | Trend monitoring |
| `findings_ingested_total` | Findings successfully ingested to Azure | - | Compare with processed |
| `batch_processing_duration_ms` | Time to process a batch | > 30s | Investigate performance |
| `azure_ingestion_errors_total` | Azure ingestion failures | > 5% | Check connectivity/auth |
| `s3_access_errors_total` | S3 access failures | > 1% | Check AWS permissions |
| `deduplication_cache_hit_rate` | Cache hit rate for deduplication | < 10% | Adjust cache size |
| `retry_attempts_total` | Total retry attempts | High trend | Investigate root cause |

#### Infrastructure Metrics

| Metric | Description | Threshold | Action |
|--------|-------------|-----------|--------|
| CPU Utilization | Worker CPU usage | > 80% | Scale up/out |
| Memory Utilization | Worker memory usage | > 85% | Scale up/out |
| Network I/O | Network throughput | Saturated | Check bandwidth |
| Disk I/O | Disk read/write operations | High latency | Optimize storage |

#### Azure Monitor Metrics

| Metric | Description | Threshold | Action |
|--------|-------------|-----------|--------|
| Ingestion Rate | Records per second ingested | Declining | Check worker health |
| Ingestion Latency | Time from S3 to Azure | > 5 minutes | Investigate delays |
| Query Performance | KQL query execution time | > 30s | Optimize queries |
| Storage Usage | Log Analytics storage | > 80% capacity | Plan retention |

### Monitoring Setup

#### Prometheus Configuration

```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'guardduty-integration'
    static_configs:
      - targets: ['guardduty-integration:3000']
    metrics_path: '/metrics'
    scrape_interval: 30s
```

#### Grafana Dashboards

Key dashboard panels:

1. **Processing Overview**
   - Findings processed per hour
   - Success/failure rates
   - Processing latency

2. **System Health**
   - CPU and memory usage
   - Network and disk I/O
   - Error rates by component

3. **Azure Integration**
   - Ingestion rates
   - Authentication status
   - DCR performance

#### Azure Monitor Alerts

```kql
// High error rate alert
GuardDutyIntegration_CL
| where TimeGenerated > ago(5m)
| where Level == "Error"
| summarize ErrorCount = count() by bin(TimeGenerated, 1m)
| where ErrorCount > 10
```

### Log Management

#### Structured Logging Format

```json
{
  "timestamp": "2024-01-21T10:30:00.000Z",
  "level": "info",
  "component": "BatchProcessor",
  "message": "Batch processing completed",
  "metadata": {
    "batchId": "batch-123",
    "findingsCount": 150,
    "duration": 2500,
    "requestId": "req-456"
  }
}
```

#### Log Aggregation

- **Centralized Logging**: Use Azure Monitor Logs or ELK stack
- **Log Retention**: Configure appropriate retention policies
- **Log Correlation**: Use request IDs for tracing
- **Sensitive Data**: Ensure no secrets in logs

## Performance Tuning

### Batch Size Optimization

#### Determining Optimal Batch Size

```bash
# Test different batch sizes
for size in 50 100 200 500; do
  echo "Testing batch size: $size"
  BATCH_SIZE=$size npm run test:performance
done
```

#### Batch Size Guidelines

| Deployment Type | Recommended Batch Size | Max Batch Size |
|----------------|----------------------|----------------|
| Lambda | 50-100 | 200 |
| Azure Functions | 100-200 | 500 |
| Container | 200-500 | 1000 |
| High-throughput Container | 500-1000 | 2000 |

### Memory Optimization

#### Memory Usage Patterns

```javascript
// Monitor memory usage
const memUsage = process.memoryUsage();
logger.info('Memory usage', {
  rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB',
  heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
  heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
  external: Math.round(memUsage.external / 1024 / 1024) + 'MB'
});
```

#### Memory Optimization Strategies

1. **Streaming Processing**: Process large files in chunks
2. **Cache Management**: Implement LRU cache for deduplication
3. **Garbage Collection**: Tune Node.js GC parameters
4. **Memory Limits**: Set appropriate container memory limits

### Network Optimization

#### Connection Pooling

```javascript
// Azure Monitor client optimization
const azureClient = new AzureMonitorClient({
  maxConnections: 10,
  keepAlive: true,
  timeout: 30000
});
```

#### Retry Strategy Optimization

```javascript
// Exponential backoff with jitter
const retryConfig = {
  maxRetries: 3,
  initialBackoffMs: 1000,
  maxBackoffMs: 30000,
  backoffMultiplier: 2,
  enableJitter: true
};
```

## Scaling Recommendations

### Horizontal Scaling

#### Container Scaling

```yaml
# Kubernetes HPA
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
        name: findings_processing_rate
      target:
        type: AverageValue
        averageValue: "100"
```

#### Lambda Scaling

- **Concurrent Executions**: Monitor and adjust reserved concurrency
- **Memory Allocation**: Increase memory for better performance
- **Timeout Settings**: Balance between processing time and cost

#### Azure Functions Scaling

- **Consumption Plan**: Automatic scaling based on demand
- **Premium Plan**: Pre-warmed instances for consistent performance
- **Dedicated Plan**: Fixed capacity for predictable workloads

### Vertical Scaling

#### Resource Allocation Guidelines

| Workload Type | CPU | Memory | Storage |
|---------------|-----|--------|---------|
| Light (< 1000 findings/hour) | 0.5 cores | 1GB | 10GB |
| Medium (1000-10000 findings/hour) | 1-2 cores | 2-4GB | 20GB |
| Heavy (> 10000 findings/hour) | 2-4 cores | 4-8GB | 50GB |

### Auto-scaling Triggers

#### Scale-out Triggers

- CPU utilization > 70% for 5 minutes
- Memory utilization > 80% for 5 minutes
- Queue depth > 1000 items
- Processing latency > 30 seconds

#### Scale-in Triggers

- CPU utilization < 30% for 15 minutes
- Memory utilization < 50% for 15 minutes
- Queue depth < 100 items
- No processing activity for 10 minutes

## Troubleshooting

### Common Issues and Solutions

#### 1. High Processing Latency

**Symptoms:**
- Findings taking > 5 minutes to appear in Azure
- High queue depth
- Timeout errors

**Diagnosis:**
```bash
# Check processing metrics
curl http://localhost:3000/metrics | grep processing_duration

# Check queue status
curl http://localhost:3000/health | jq '.components[] | select(.name=="BatchProcessor")'
```

**Solutions:**
- Increase batch size
- Scale out workers
- Optimize network connectivity
- Check Azure Monitor ingestion limits

#### 2. Authentication Failures

**Symptoms:**
- 401/403 errors in logs
- Azure ingestion failures
- S3 access denied errors

**Diagnosis:**
```bash
# Test Azure authentication
az login --service-principal -u $AZURE_CLIENT_ID -p $AZURE_CLIENT_SECRET --tenant $AZURE_TENANT_ID

# Test AWS authentication
aws sts get-caller-identity
```

**Solutions:**
- Verify service principal permissions
- Check credential expiration
- Validate IAM roles and policies
- Rotate credentials if compromised

#### 3. Memory Leaks

**Symptoms:**
- Gradually increasing memory usage
- Out of memory errors
- Container restarts

**Diagnosis:**
```bash
# Monitor memory usage over time
docker stats guardduty-integration

# Generate heap dump
kill -USR2 $(pgrep node)
```

**Solutions:**
- Implement proper cleanup in event handlers
- Use streaming for large file processing
- Adjust garbage collection settings
- Set memory limits and restart policies

#### 4. Data Quality Issues

**Symptoms:**
- Missing findings in Azure
- Duplicate findings
- Malformed data

**Diagnosis:**
```kql
// Check for missing findings
GuardDutyFindings_CL
| where TimeGenerated > ago(1h)
| summarize count() by bin(TimeGenerated, 5m)
| render timechart

// Check for duplicates
GuardDutyFindings_CL
| where TimeGenerated > ago(1h)
| summarize count() by FindingId
| where count_ > 1
```

**Solutions:**
- Verify S3 event configuration
- Check deduplication settings
- Validate JSON schema compliance
- Review data transformation logic

### Diagnostic Tools

#### Health Check Endpoint

```bash
# Comprehensive health check
curl -s http://localhost:3000/health | jq '.'

# Component-specific health
curl -s http://localhost:3000/health | jq '.components[] | select(.name=="AzureMonitor")'
```

#### Metrics Endpoint

```bash
# Get all metrics
curl -s http://localhost:3000/metrics

# Filter specific metrics
curl -s http://localhost:3000/metrics | grep findings_processed
```

#### Log Analysis

```bash
# Search for errors in last hour
docker logs guardduty-integration --since 1h | grep ERROR

# Count error types
docker logs guardduty-integration --since 1h | grep ERROR | awk '{print $4}' | sort | uniq -c
```

## Maintenance Procedures

### Regular Maintenance Tasks

#### Daily Tasks

1. **Health Check Review**
   - Verify all components are healthy
   - Check processing rates and latency
   - Review error logs

2. **Capacity Monitoring**
   - Monitor resource utilization
   - Check queue depths
   - Verify scaling behavior

#### Weekly Tasks

1. **Performance Review**
   - Analyze processing trends
   - Review scaling events
   - Optimize configurations

2. **Security Review**
   - Check for security alerts
   - Review access logs
   - Validate credential rotation

#### Monthly Tasks

1. **Capacity Planning**
   - Analyze growth trends
   - Plan for peak loads
   - Review cost optimization

2. **Disaster Recovery Testing**
   - Test backup procedures
   - Validate recovery processes
   - Update runbooks

### Update Procedures

#### Application Updates

```bash
# Rolling update for containers
kubectl set image deployment/guardduty-integration \
  guardduty-integration=your-registry/guardduty-integration:v1.1.0

# Lambda function update
aws lambda update-function-code \
  --function-name guardduty-sentinel-integration \
  --zip-file fileb://guardduty-lambda-v1.1.0.zip
```

#### Configuration Updates

```bash
# Update ConfigMap in Kubernetes
kubectl patch configmap guardduty-config \
  --patch '{"data":{"BATCH_SIZE":"200"}}'

# Restart deployment to pick up changes
kubectl rollout restart deployment/guardduty-integration
```

### Backup Procedures

#### Configuration Backup

```bash
# Backup Kubernetes resources
kubectl get all,configmap,secret -n guardduty-integration -o yaml > backup-$(date +%Y%m%d).yaml

# Backup Terraform state
terraform state pull > terraform-state-backup-$(date +%Y%m%d).json
```

#### Data Backup

- **Azure Monitor Logs**: Configure data export to storage account
- **Configuration Files**: Store in version control
- **Secrets**: Backup to secure key management system

## Incident Response

### Incident Classification

#### Severity Levels

| Severity | Description | Response Time | Examples |
|----------|-------------|---------------|----------|
| P1 - Critical | Complete service outage | 15 minutes | All workers down, authentication failure |
| P2 - High | Significant degradation | 1 hour | High error rates, processing delays |
| P3 - Medium | Minor issues | 4 hours | Single component failure, performance issues |
| P4 - Low | Cosmetic issues | 24 hours | Logging issues, minor bugs |

### Incident Response Procedures

#### P1 - Critical Incidents

1. **Immediate Response (0-15 minutes)**
   - Acknowledge incident
   - Assess impact and scope
   - Implement immediate workarounds
   - Notify stakeholders

2. **Investigation (15-60 minutes)**
   - Gather diagnostic information
   - Identify root cause
   - Implement fix or rollback
   - Monitor recovery

3. **Recovery (1-4 hours)**
   - Verify full service restoration
   - Conduct post-incident review
   - Update documentation
   - Implement preventive measures

#### Escalation Procedures

1. **Level 1**: On-call engineer
2. **Level 2**: Senior engineer + team lead
3. **Level 3**: Engineering manager + architect
4. **Level 4**: Director + external vendors

### Communication Templates

#### Incident Notification

```
INCIDENT: GuardDuty Integration Service Degradation
Severity: P2
Start Time: 2024-01-21 10:30 UTC
Impact: Processing delays of 15-30 minutes
Status: Investigating
Next Update: 11:00 UTC
```

#### Resolution Notification

```
RESOLVED: GuardDuty Integration Service Degradation
Duration: 45 minutes
Root Cause: Azure Monitor rate limiting
Resolution: Implemented exponential backoff
Follow-up: Capacity planning review scheduled
```

## Security Operations

### Security Monitoring

#### Key Security Metrics

- Failed authentication attempts
- Unusual access patterns
- Data exfiltration indicators
- Configuration changes
- Privilege escalations

#### Security Alerts

```kql
// Suspicious authentication patterns
GuardDutyIntegration_CL
| where TimeGenerated > ago(1h)
| where Message contains "authentication failed"
| summarize FailureCount = count() by SourceIP = tostring(Metadata.sourceIP)
| where FailureCount > 10
```

### Incident Response for Security Events

#### Security Incident Types

1. **Credential Compromise**
   - Rotate affected credentials immediately
   - Review access logs
   - Assess data exposure
   - Notify security team

2. **Unauthorized Access**
   - Block suspicious IPs
   - Review permissions
   - Audit recent activities
   - Implement additional controls

3. **Data Breach**
   - Isolate affected systems
   - Preserve evidence
   - Notify legal/compliance
   - Follow breach procedures

### Compliance and Auditing

#### Audit Logging

- All configuration changes
- Authentication events
- Data access patterns
- System modifications
- Error conditions

#### Compliance Requirements

- **SOC 2**: Implement security controls
- **GDPR**: Data protection measures
- **HIPAA**: Healthcare data handling (if applicable)
- **PCI DSS**: Payment data security (if applicable)

## Performance Baselines

### Baseline Metrics

| Metric | Baseline | Target | Alert Threshold |
|--------|----------|--------|-----------------|
| Processing Rate | 1000 findings/hour | 2000 findings/hour | < 500 findings/hour |
| Ingestion Latency | 2 minutes | 1 minute | > 5 minutes |
| Error Rate | < 1% | < 0.5% | > 5% |
| CPU Utilization | 40% | 60% | > 80% |
| Memory Utilization | 50% | 70% | > 85% |

### Capacity Planning

#### Growth Projections

- **Monthly Growth**: 20% increase in findings volume
- **Peak Load**: 3x normal load during security incidents
- **Seasonal Patterns**: Higher activity during business hours

#### Scaling Timeline

- **Immediate**: Auto-scaling within 5 minutes
- **Short-term**: Manual scaling within 1 hour
- **Long-term**: Capacity planning quarterly

For additional operational procedures and advanced troubleshooting, see the [Troubleshooting Guide](troubleshooting-guide.md).