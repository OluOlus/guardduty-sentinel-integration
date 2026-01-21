/**
 * Azure integration interfaces for Monitor Logs and Sentinel
 */

export interface AzureMonitorIngestionRequest {
  /** Data to be ingested */
  data: Record<string, unknown>[];
  /** Stream name for the data */
  streamName: string;
  /** Request timestamp */
  timestamp: Date;
}

export interface AzureMonitorIngestionResponse {
  /** Ingestion status */
  status: 'success' | 'partial' | 'failed';
  /** Number of records accepted */
  acceptedRecords: number;
  /** Number of records rejected */
  rejectedRecords: number;
  /** Error details if any */
  errors?: AzureIngestionError[];
  /** Response timestamp */
  timestamp: Date;
  /** Request ID for tracking */
  requestId: string;
}

export interface AzureIngestionError {
  /** Error code */
  code: string;
  /** Error message */
  message: string;
  /** Record index that caused the error */
  recordIndex?: number;
  /** Field name that caused the error */
  fieldName?: string;
  /** Additional error details */
  details?: Record<string, unknown>;
}

export interface DataCollectionRule {
  /** DCR resource ID */
  id: string;
  /** DCR name */
  name: string;
  /** DCR location */
  location: string;
  /** DCR kind */
  kind: 'Direct' | 'AgentDirectToStore';
  /** DCR properties */
  properties: DataCollectionRuleProperties;
}

export interface DataCollectionRuleProperties {
  /** Stream declarations */
  streamDeclarations: Record<string, StreamDeclaration>;
  /** Data sources configuration */
  dataSources?: DataSources;
  /** Destinations configuration */
  destinations: Destinations;
  /** Data flows configuration */
  dataFlows: DataFlow[];
  /** DCR description */
  description?: string;
}

export interface StreamDeclaration {
  /** Stream columns definition */
  columns: StreamColumn[];
}

export interface StreamColumn {
  /** Column name */
  name: string;
  /** Column data type */
  type: 'string' | 'int' | 'long' | 'real' | 'boolean' | 'datetime' | 'guid' | 'timespan';
  /** Column description */
  description?: string;
}

export interface DataSources {
  /** Performance counters */
  performanceCounters?: PerformanceCounterDataSource[];
  /** Windows event logs */
  windowsEventLogs?: WindowsEventLogDataSource[];
  /** Syslog */
  syslog?: SyslogDataSource[];
  /** Extensions */
  extensions?: ExtensionDataSource[];
}

export interface Destinations {
  /** Log Analytics destinations */
  logAnalytics?: LogAnalyticsDestination[];
  /** Azure Monitor Metrics destinations */
  azureMonitorMetrics?: AzureMonitorMetricsDestination;
}

export interface LogAnalyticsDestination {
  /** Destination name */
  name: string;
  /** Workspace resource ID */
  workspaceResourceId: string;
  /** Workspace ID */
  workspaceId?: string;
}

export interface AzureMonitorMetricsDestination {
  /** Destination name */
  name: string;
}

export interface DataFlow {
  /** Source streams */
  streams: string[];
  /** Destination names */
  destinations: string[];
  /** Transform KQL query */
  transformKql?: string;
  /** Output stream name */
  outputStream?: string;
}

export interface PerformanceCounterDataSource {
  /** Data source name */
  name: string;
  /** Streams */
  streams: string[];
  /** Sampling frequency in seconds */
  samplingFrequencyInSeconds: number;
  /** Counter specifiers */
  counterSpecifiers: string[];
}

export interface WindowsEventLogDataSource {
  /** Data source name */
  name: string;
  /** Streams */
  streams: string[];
  /** XPath queries */
  xPathQueries: string[];
}

export interface SyslogDataSource {
  /** Data source name */
  name: string;
  /** Streams */
  streams: string[];
  /** Facility names */
  facilityNames: string[];
  /** Log levels */
  logLevels: string[];
}

export interface ExtensionDataSource {
  /** Data source name */
  name: string;
  /** Streams */
  streams: string[];
  /** Extension name */
  extensionName: string;
  /** Extension settings */
  extensionSettings?: Record<string, unknown>;
}

export interface SentinelAnalyticsRule {
  /** Rule ID */
  id: string;
  /** Rule name */
  name: string;
  /** Rule display name */
  displayName: string;
  /** Rule description */
  description: string;
  /** Rule severity */
  severity: 'Informational' | 'Low' | 'Medium' | 'High';
  /** Rule enabled status */
  enabled: boolean;
  /** KQL query */
  query: string;
  /** Query frequency (ISO 8601 duration) */
  queryFrequency: string;
  /** Query period (ISO 8601 duration) */
  queryPeriod: string;
  /** Trigger operator */
  triggerOperator: 'GreaterThan' | 'LessThan' | 'Equal' | 'NotEqual';
  /** Trigger threshold */
  triggerThreshold: number;
  /** Suppression settings */
  suppressionDuration?: string;
  /** Suppression enabled */
  suppressionEnabled?: boolean;
  /** Tactics */
  tactics?: string[];
  /** Techniques */
  techniques?: string[];
  /** Alert rule template name */
  alertRuleTemplateName?: string;
  /** Template version */
  templateVersion?: string;
}

export interface SentinelIncident {
  /** Incident ID */
  id: string;
  /** Incident number */
  incidentNumber: number;
  /** Incident title */
  title: string;
  /** Incident description */
  description: string;
  /** Incident severity */
  severity: 'Informational' | 'Low' | 'Medium' | 'High';
  /** Incident status */
  status: 'New' | 'Active' | 'Closed';
  /** Classification */
  classification?: 'Undetermined' | 'TruePositive' | 'BenignPositive' | 'FalsePositive';
  /** Classification reason */
  classificationReason?: string;
  /** Owner */
  owner?: IncidentOwner;
  /** Labels */
  labels?: IncidentLabel[];
  /** First activity time */
  firstActivityTimeUtc?: Date;
  /** Last activity time */
  lastActivityTimeUtc?: Date;
  /** Last modified time */
  lastModifiedTimeUtc: Date;
  /** Created time */
  createdTimeUtc: Date;
  /** Related analytics rule IDs */
  relatedAnalyticRuleIds?: string[];
}

export interface IncidentOwner {
  /** Owner email */
  email?: string;
  /** Owner assigned date */
  assignedTo?: string;
  /** Owner object ID */
  objectId?: string;
  /** Owner user principal name */
  userPrincipalName?: string;
}

export interface IncidentLabel {
  /** Label name */
  labelName: string;
  /** Label type */
  labelType: 'User' | 'System';
}

export interface SentinelWorkbook {
  /** Workbook ID */
  id: string;
  /** Workbook name */
  name: string;
  /** Workbook display name */
  displayName: string;
  /** Workbook description */
  description?: string;
  /** Workbook category */
  category: string;
  /** Workbook tags */
  tags?: string[];
  /** Workbook version */
  version: string;
  /** Workbook author */
  author: string;
  /** Workbook source */
  source: string;
  /** Workbook serialized data */
  serializedData: string;
}

export interface KqlFunction {
  /** Function name */
  name: string;
  /** Function display name */
  displayName: string;
  /** Function description */
  description?: string;
  /** Function body (KQL query) */
  body: string;
  /** Function parameters */
  parameters?: KqlFunctionParameter[];
  /** Function category */
  category?: string;
}

export interface KqlFunctionParameter {
  /** Parameter name */
  name: string;
  /** Parameter type */
  type: string;
  /** Parameter description */
  description?: string;
  /** Default value */
  defaultValue?: string;
  /** Is parameter required */
  isRequired: boolean;
}
