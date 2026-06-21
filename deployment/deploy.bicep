@description('Name of the Log Analytics workspace where GuardDuty data is ingested')
param workspaceName string

@description('Resource group name where the workspace is located')
param resourceGroupName string = resourceGroup().name

@description('Name of the table where GuardDuty findings are stored')
@allowed(['AWSGuardDuty', 'AmazonGuardDutyFindings', 'GuardDutyFindings'])
param guardDutyTableName string = 'AWSGuardDuty'

@description('Name of the primary column containing raw GuardDuty JSON data')
@allowed(['EventData', 'Message', 'RawData'])
param rawDataColumn string = 'EventData'

@description('Name of the alternate column for raw JSON data (fallback)')
@allowed(['Message', 'EventData', 'RawData'])
param alternateRawDataColumn string = 'Message'

@description('Default time range for GuardDuty queries')
@allowed(['1d', '7d', '30d', '90d'])
param defaultLookback string = '7d'

@description('Maximum allowed lookback period for performance')
@allowed(['30d', '90d', '180d', '365d'])
param maxLookback string = '90d'

@description('Enable geographic IP enrichment using Sentinel functions')
param enableGeoEnrichment bool = true

@description('Enable ASIM schema normalization')
param enableASIMNormalization bool = true

@description('Enable strict data validation and quality checks')
param enableDataValidation bool = true

@description('Environment tag for deployment tracking')
@allowed(['dev', 'test', 'staging', 'prod'])
param environment string = 'prod'

@description('Deployment timestamp for tracking')
param deploymentTimestamp string = utcNow('yyyy-MM-dd HH:mm:ss')

var parserVersion = '1.1.0'
var schemaVersion = '2.0'

// Validation: Ensure alternate column is different from primary
var validatedAlternateColumn = (alternateRawDataColumn == rawDataColumn) ? 'Message' : alternateRawDataColumn

// Configuration function with enhanced settings
resource configFunction 'Microsoft.OperationalInsights/workspaces/savedSearches@2020-08-01' = {
  name: '${workspaceName}/AWSGuardDuty_Config'
  properties: {
    displayName: 'AWSGuardDuty_Config'
    category: 'GuardDuty'
    tags: {
      Environment: environment
      Version: parserVersion
      DeployedAt: deploymentTimestamp
    }
    query: '''// AWSGuardDuty_Config
// Configuration function for GuardDuty parsers
// This function centralizes table names and settings for all GuardDuty parsers
let AWSGuardDuty_Config = () {
    datatable(
        Setting: string,
        Value: string,
        Description: string,
        DefaultValue: string
    )[
        // Core table configuration
        "TableName", "${guardDutyTableName}", "Primary table where GuardDuty data lands via AWS S3 connector", "AWSGuardDuty",
        "RawColumn", "${rawDataColumn}", "Column containing raw GuardDuty JSON data", "EventData",
        "AlternateRawColumn", "${validatedAlternateColumn}", "Fallback column for raw JSON data", "Message",
        
        // Time and performance settings
        "DefaultLookback", "${defaultLookback}", "Default time range for queries when not specified", "7d",
        "MaxLookback", "${maxLookback}", "Maximum allowed lookback period for performance", "90d",
        "QueryTimeout", "300", "Query timeout in seconds", "300",
        
        // Data quality thresholds
        "MinSeverityScore", "0.0", "Minimum severity score to process", "0.0",
        "MaxSeverityScore", "10.0", "Maximum expected severity score", "10.0",
        "RequiredFields", "id,type,severity,accountId,region", "Comma-separated list of required GuardDuty fields", "id,type,severity,accountId,region",
        
        // Parser metadata
        "ParserVersion", "${parserVersion}", "Current parser version for tracking", "1.1.0",
        "SchemaVersion", "${schemaVersion}", "Expected GuardDuty schema version", "2.0",
        "LastUpdated", "${deploymentTimestamp}", "Last parser update date", "2024-02-01",
        
        // Feature flags
        "EnableGeoEnrichment", "${enableGeoEnrichment}", "Enable geographic IP enrichment", "true",
        "EnableASIMNormalization", "${enableASIMNormalization}", "Enable ASIM schema normalization", "true",
        "EnableDataValidation", "${enableDataValidation}", "Enable strict data validation", "true",
        "EnablePerformanceLogging", "false", "Enable query performance logging", "false"
    ]
};
AWSGuardDuty_Config'''
    functionAlias: 'AWSGuardDuty_Config'
    functionParameters: ''
  }
}

// Schema validation function
resource schemaFunction 'Microsoft.OperationalInsights/workspaces/savedSearches@2020-08-01' = {
  name: '${workspaceName}/AWSGuardDuty_Schema'
  dependsOn: [configFunction]
  properties: {
    displayName: 'AWSGuardDuty_Schema'
    category: 'GuardDuty'
    tags: {
      Environment: environment
      Version: parserVersion
      DeployedAt: deploymentTimestamp
    }
    query: '''// AWSGuardDuty_Schema
// Data quality validation and schema checking for GuardDuty findings
// Validates data structure, completeness, and identifies quality issues
let AWSGuardDuty_Schema = (lookback: timespan = timespan(null)) {
    let config = AWSGuardDuty_Config();
    let _lookback = iff(isnull(lookback), totimespan(toscalar(config | where Setting == "DefaultLookback" | project Value)), lookback);
    let _tableName = toscalar(config | where Setting == "TableName" | project Value);
    let _rawColumn = toscalar(config | where Setting == "RawColumn" | project Value);
    let _altRawColumn = toscalar(config | where Setting == "AlternateRawColumn" | project Value);
    //
    table(_tableName)
    | where TimeGenerated >= ago(_lookback)
    | extend RawJson = iff(isnotempty(column_ifexists(_rawColumn, "")), column_ifexists(_rawColumn, ""), column_ifexists(_altRawColumn, ""))
    | where isnotempty(RawJson)
    | extend gd = try_parse_json(RawJson)
    | extend
        HasValidJson = isnotempty(gd) and gd != dynamic({}),
        HasFindingId = isnotempty(tostring(gd.id)),
        HasFindingType = isnotempty(tostring(gd.type)),
        HasSeverity = isnotnull(todouble(gd.severity)),
        HasAccountId = isnotempty(tostring(gd.accountId)),
        HasRegion = isnotempty(tostring(gd.region)),
        HasTimestamp = isnotempty(tostring(gd.createdAt)),
        SchemaVersion = tostring(gd.schemaVersion)
    | extend QualityCategory = case(
        not(HasValidJson), "Invalid JSON",
        not(HasFindingId), "Missing FindingId", 
        not(HasFindingType), "Missing FindingType",
        not(HasSeverity), "Missing Severity",
        not(HasAccountId), "Missing AccountId",
        not(HasRegion), "Missing Region",
        not(HasTimestamp), "Missing Timestamp",
        isempty(SchemaVersion), "Missing Schema Version",
        not(SchemaVersion startswith "2."), "Unsupported Schema Version",
        "Valid"
    )
    | project TimeGenerated, QualityCategory, SchemaVersion, RawJson
};
AWSGuardDuty_Schema'''
    functionAlias: 'AWSGuardDuty_Schema'
    functionParameters: 'lookback:timespan=timespan(null)'
  }
}

// Main parser function
resource mainFunction 'Microsoft.OperationalInsights/workspaces/savedSearches@2020-08-01' = {
  name: '${workspaceName}/AWSGuardDuty_Main'
  dependsOn: [configFunction]
  properties: {
    displayName: 'AWSGuardDuty_Main'
    category: 'GuardDuty'
    tags: {
      Environment: environment
      Version: parserVersion
      DeployedAt: deploymentTimestamp
    }
    query: '''// AWSGuardDuty_Main
// Main parser function for GuardDuty findings
// Extracts core fields and provides consistent schema with enhanced error handling
let AWSGuardDuty_Main = (lookback: timespan = timespan(null)) {
    // Get configuration values with error handling
    let config = AWSGuardDuty_Config();
    let _lookback = iff(
        isnull(lookback), 
        totimespan(toscalar(config | where Setting == "DefaultLookback" | project Value)), 
        iff(lookback > totimespan(toscalar(config | where Setting == "MaxLookback" | project Value)),
            totimespan(toscalar(config | where Setting == "MaxLookback" | project Value)),
            lookback)
    );
    let _tableName = toscalar(config | where Setting == "TableName" | project Value);
    let _rawColumn = toscalar(config | where Setting == "RawColumn" | project Value);
    let _altRawColumn = toscalar(config | where Setting == "AlternateRawColumn" | project Value);
    let _enableValidation = tobool(toscalar(config | where Setting == "EnableDataValidation" | project Value));
    let _requiredFields = split(toscalar(config | where Setting == "RequiredFields" | project Value), ",");
    let _minSeverity = todouble(toscalar(config | where Setting == "MinSeverityScore" | project Value));
    let _maxSeverity = todouble(toscalar(config | where Setting == "MaxSeverityScore" | project Value));
    //
    // Dynamic table access with fallback handling
    table(_tableName)
    | where TimeGenerated >= ago(_lookback)
    // Try primary raw column, fallback to alternate
    | extend RawJson = iff(
        isnotempty(column_ifexists(_rawColumn, "")), 
        column_ifexists(_rawColumn, ""),
        column_ifexists(_altRawColumn, "")
    )
    | where isnotempty(RawJson)
    //
    // Parse JSON with error handling
    | extend gd = iff(
        isnotempty(RawJson),
        try_parse_json(RawJson),
        dynamic({})
    )
    | where isnotempty(gd) and gd != dynamic({})
    //
    // Validate schema version if validation enabled
    | extend SchemaVersion = tostring(gd.schemaVersion)
    | where not(_enableValidation) or (isnotempty(SchemaVersion) and SchemaVersion startswith "2.")
    //
    // Extract core GuardDuty fields with error handling
    | extend
        EventTime = iff(
            isnotempty(tostring(gd.createdAt)),
            todatetime(gd.createdAt),
            TimeGenerated
        ),
        UpdatedTime = todatetime(gd.updatedAt),
        FindingId = tostring(gd.id),
        FindingType = tostring(gd.type),
        Severity = iff(
            isnull(todouble(gd.severity)) or todouble(gd.severity) < _minSeverity or todouble(gd.severity) > _maxSeverity,
            0.0,
            todouble(gd.severity)
        ),
        Title = tostring(gd.title),
        Description = tostring(gd.description),
        AwsAccountId = tostring(gd.accountId),
        AwsRegion = tostring(gd.region),
        ServiceName = tostring(gd.service.serviceName),
        ResourceType = tostring(gd.resource.resourceType),
        ActionType = tostring(gd.service.action.actionType),
        Partition = tostring(gd.partition),
        DetectorId = tostring(gd.service.detectorId)
    //
    // Data quality validation
    | extend DataQualityScore = 
        iff(isnotempty(FindingId), 20, 0) +
        iff(isnotempty(FindingType), 20, 0) +
        iff(isnotnull(Severity) and Severity > 0, 20, 0) +
        iff(isnotempty(AwsAccountId), 20, 0) +
        iff(isnotempty(AwsRegion), 20, 0)
    //
    // Filter out low quality records if validation enabled
    | where not(_enableValidation) or DataQualityScore >= 60
    //
    // Standardize severity levels with enhanced logic
    | extend SeverityLevel = case(
        Severity >= 8.5, "Critical",
        Severity >= 7.0, "High",
        Severity >= 4.0, "Medium", 
        Severity >= 1.0, "Low",
        Severity > 0, "Informational",
        "Unknown"
    )
    //
    // Add parsing metadata
    | extend 
        ParsingTimestamp = now(),
        ParserVersion = toscalar(config | where Setting == "ParserVersion" | project Value),
        RecordSource = "AWSGuardDuty_Main"
    //
    // Project final schema with consistent field ordering
    | project 
        // Timestamps
        TimeGenerated,
        EventTime,
        UpdatedTime,
        ParsingTimestamp,
        // Core identifiers
        FindingId,
        FindingType,
        DetectorId,
        // Severity information
        Severity,
        SeverityLevel,
        // Content
        Title,
        Description,
        // AWS context
        AwsAccountId,
        AwsRegion,
        Partition,
        // Service context
        ServiceName,
        ResourceType,
        ActionType,
        // Quality metrics
        DataQualityScore,
        SchemaVersion,
        // Metadata
        ParserVersion,
        RecordSource,
        // Raw data for downstream processing
        RawJson,
        gd  // Parsed JSON for downstream parsers
};
AWSGuardDuty_Main'''
    functionAlias: 'AWSGuardDuty_Main'
    functionParameters: 'lookback:timespan=timespan(null)'
  }
}

// Network parser function
resource networkFunction 'Microsoft.OperationalInsights/workspaces/savedSearches@2020-08-01' = {
  name: '${workspaceName}/AWSGuardDuty_Network'
  dependsOn: [mainFunction]
  properties: {
    displayName: 'AWSGuardDuty_Network'
    category: 'GuardDuty'
    tags: {
      Environment: environment
      Version: parserVersion
      DeployedAt: deploymentTimestamp
    }
    query: '''// AWSGuardDuty_Network
// Enhanced network-focused parser for GuardDuty findings
// Extracts network connection details, geographic information, and threat intelligence
let AWSGuardDuty_Network = (lookback: timespan = timespan(null)) {
    AWSGuardDuty_Main(lookback)
    | where ActionType in ("NETWORK_CONNECTION", "DNS_REQUEST", "PORT_PROBE") or 
            FindingType has_any("Backdoor", "Trojan", "CryptoCurrency", "DNS", "Recon", "Brute")
    //
    // Enhanced network connection extraction with multiple fallback paths
    | extend
        // Connection details with comprehensive fallbacks
        RemoteIp = coalesce(
            tostring(gd.service.action.networkConnectionAction.remoteIpDetails.ipAddressV4),
            tostring(gd.service.remoteIpDetails.ipAddressV4),
            tostring(gd.service.action.awsApiCallAction.remoteIpDetails.ipAddressV4),
            tostring(gd.service.action.dnsRequestAction.remoteIpDetails.ipAddressV4)
        ),
        RemotePort = coalesce(
            toint(gd.service.action.networkConnectionAction.remotePortDetails.port),
            toint(gd.service.action.portProbeAction.portProbeDetails[0].remoteIpDetails.port)
        ),
        LocalIp = coalesce(
            tostring(gd.service.action.networkConnectionAction.localIpDetails.ipAddressV4),
            tostring(gd.resource.instanceDetails.networkInterfaces[0].privateIpAddress)
        ),
        LocalPort = coalesce(
            toint(gd.service.action.networkConnectionAction.localPortDetails.port),
            toint(gd.service.action.portProbeAction.portProbeDetails[0].localPortDetails.port)
        ),
        Protocol = coalesce(
            tostring(gd.service.action.networkConnectionAction.protocol),
            tostring(gd.service.action.portProbeAction.portProbeDetails[0].protocol),
            "TCP"
        ),
        // Enhanced traffic direction with better logic
        TrafficDirection = case(
            ActionType == "NETWORK_CONNECTION" and tostring(gd.service.action.networkConnectionAction.connectionDirection) == "INBOUND", "INBOUND",
            ActionType == "NETWORK_CONNECTION" and tostring(gd.service.action.networkConnectionAction.connectionDirection) == "OUTBOUND", "OUTBOUND",
            ActionType == "DNS_REQUEST", "OUTBOUND",
            ActionType == "PORT_PROBE", "INBOUND",
            FindingType has "Backdoor", "INBOUND",
            FindingType has "CryptoCurrency", "OUTBOUND",
            "UNKNOWN"
        ),
        // DNS-specific fields
        DomainName = coalesce(
            tostring(gd.service.action.dnsRequestAction.domain),
            tostring(gd.service.action.networkConnectionAction.remoteIpDetails.hostname)
        )
    //
    // Enhanced geographic and organization information
    | extend
        RemoteCountry = coalesce(
            tostring(gd.service.action.networkConnectionAction.remoteIpDetails.country.countryName),
            tostring(gd.service.remoteIpDetails.country.countryName),
            tostring(gd.service.action.awsApiCallAction.remoteIpDetails.country.countryName)
        ),
        RemoteCity = coalesce(
            tostring(gd.service.action.networkConnectionAction.remoteIpDetails.city.cityName),
            tostring(gd.service.remoteIpDetails.city.cityName),
            tostring(gd.service.action.awsApiCallAction.remoteIpDetails.city.cityName)
        ),
        RemoteOrganization = coalesce(
            tostring(gd.service.action.networkConnectionAction.remoteIpDetails.organization.org),
            tostring(gd.service.remoteIpDetails.organization.org),
            tostring(gd.service.action.awsApiCallAction.remoteIpDetails.organization.org)
        ),
        RemoteIsp = coalesce(
            tostring(gd.service.action.networkConnectionAction.remoteIpDetails.organization.isp),
            tostring(gd.service.remoteIpDetails.organization.isp),
            tostring(gd.service.action.awsApiCallAction.remoteIpDetails.organization.isp)
        ),
        RemoteAsn = coalesce(
            tostring(gd.service.action.networkConnectionAction.remoteIpDetails.organization.asn),
            tostring(gd.service.remoteIpDetails.organization.asn)
        )
    //
    // Enhanced AWS resource context
    | extend
        InstanceId = tostring(gd.resource.instanceDetails.instanceId),
        InstanceType = tostring(gd.resource.instanceDetails.instanceType),
        VpcId = tostring(gd.resource.instanceDetails.networkInterfaces[0].vpcId),
        SubnetId = tostring(gd.resource.instanceDetails.networkInterfaces[0].subnetId),
        SecurityGroupId = tostring(gd.resource.instanceDetails.networkInterfaces[0].securityGroups[0].groupId),
        NetworkInterface = tostring(gd.resource.instanceDetails.networkInterfaces[0].networkInterfaceId),
        PrivateIp = coalesce(
            LocalIp,
            tostring(gd.resource.instanceDetails.networkInterfaces[0].privateIpAddress)
        ),
        PublicIp = tostring(gd.resource.instanceDetails.networkInterfaces[0].publicIp),
        // Enhanced instance metadata
        Platform = tostring(gd.resource.instanceDetails.platform),
        Architecture = tostring(gd.resource.instanceDetails.architecture),
        ImageId = tostring(gd.resource.instanceDetails.imageId),
        LaunchTime = todatetime(gd.resource.instanceDetails.launchTime)
    //
    // Enhanced threat categorization with intelligence
    | extend ThreatCategory = case(
        FindingType has_any("Backdoor", "Trojan") and RemoteCountry in ("China", "Russia", "North Korea", "Iran"), "High Risk",
        FindingType has_any("CryptoCurrency", "Mining") and Protocol == "TCP", "Medium Risk",
        FindingType has_any("DNS", "DomainGeneration") and isnotempty(DomainName), "Medium Risk",
        FindingType has_any("Recon", "PortProbe", "Brute") and TrafficDirection == "INBOUND", "Medium Risk",
        RemoteOrganization has_any("Tor", "VPN", "Proxy"), "Medium Risk",
        RemoteCountry in ("China", "Russia", "North Korea", "Iran", "Syria"), "Medium Risk",
        SeverityLevel == "High", "High Risk",
        SeverityLevel == "Medium", "Medium Risk",
        "Low Risk"
    ),
    // Enhanced threat list detection
    ThreatListName = case(
        FindingType has "ThreatIntelligenceDetails", tostring(gd.service.additionalInfo.threatListName),
        FindingType has "Malware", "Malware Indicators",
        FindingType has "CryptoCurrency", "Cryptocurrency Mining",
        ""
    ),
    // Connection state inference
    ConnectionState = case(
        ActionType == "NETWORK_CONNECTION" and isnotempty(RemoteIp), "Established",
        ActionType == "PORT_PROBE", "Attempted",
        ActionType == "DNS_REQUEST", "DNS Query",
        "Unknown"
    )
    //
    // Data quality validation for network data
    | extend NetworkDataQuality = case(
        isempty(RemoteIp) and ActionType in ("NETWORK_CONNECTION", "PORT_PROBE"), "Missing Remote IP",
        isempty(Protocol) and ActionType == "NETWORK_CONNECTION", "Missing Protocol",
        isempty(DomainName) and ActionType == "DNS_REQUEST", "Missing Domain",
        "Good"
    )
    //
    // Filter for network-relevant findings only
    | where isnotempty(RemoteIp) or isnotempty(DomainName) or ActionType in ("NETWORK_CONNECTION", "DNS_REQUEST", "PORT_PROBE")
    //
    // Project comprehensive network fields
    | project 
        TimeGenerated,
        EventTime,
        FindingId,
        FindingType,
        ThreatCategory,
        Severity,
        SeverityLevel,
        Title,
        Description,
        AwsAccountId,
        AwsRegion,
        // Network connection details
        RemoteIp,
        RemotePort,
        LocalIp,
        LocalPort,
        Protocol,
        TrafficDirection,
        ConnectionState,
        DomainName,
        // Geographic and organization context
        RemoteCountry,
        RemoteCity,
        RemoteOrganization,
        RemoteIsp,
        RemoteAsn,
        // AWS resource context
        InstanceId,
        InstanceType,
        VpcId,
        SubnetId,
        SecurityGroupId,
        NetworkInterface,
        PrivateIp,
        PublicIp,
        Platform,
        Architecture,
        ImageId,
        LaunchTime,
        // Threat intelligence
        ThreatListName,
        NetworkDataQuality,
        RawJson
};
AWSGuardDuty_Network'''
    functionAlias: 'AWSGuardDuty_Network'
    functionParameters: 'lookback:timespan=timespan(null)'
  }
}

// IAM parser function
resource iamFunction 'Microsoft.OperationalInsights/workspaces/savedSearches@2020-08-01' = {
  name: '${workspaceName}/AWSGuardDuty_IAM'
  dependsOn: [mainFunction]
  properties: {
    displayName: 'AWSGuardDuty_IAM'
    category: 'GuardDuty'
    tags: {
      Environment: environment
      Version: parserVersion
      DeployedAt: deploymentTimestamp
    }
    query: '''// AWSGuardDuty_IAM
// Enhanced IAM-focused parser for GuardDuty findings
// Extracts API call details, identity context, and authentication information
let AWSGuardDuty_IAM = (lookback: timespan = timespan(null)) {
    AWSGuardDuty_Main(lookback)
    | where ActionType == "AWS_API_CALL" or FindingType has_any("IAM", "Stealth", "Policy", "Credential", "UnauthorizedAPI", "Persistence", "PrivilegeEscalation")
    //
    // Extract comprehensive API call details with error handling
    | extend
        ApiName = coalesce(
            tostring(gd.service.action.awsApiCallAction.api),
            tostring(gd.service.action.dnsRequestAction.domain),
            "Unknown"
        ),
        ServiceName_API = coalesce(
            tostring(gd.service.action.awsApiCallAction.serviceName),
            extract(@"^([^\.]+)", 1, tostring(gd.service.action.awsApiCallAction.api)),
            "Unknown"
        ),
        CallerType = coalesce(
            tostring(gd.service.action.awsApiCallAction.callerType),
            "Unknown"
        ),
        ErrorCode = tostring(gd.service.action.awsApiCallAction.errorCode),
        UserAgent = coalesce(
            tostring(gd.service.action.awsApiCallAction.userAgent),
            "Unknown"
        ),
        // Enhanced remote IP extraction with fallbacks
        RemoteIp_API = coalesce(
            tostring(gd.service.action.awsApiCallAction.remoteIpDetails.ipAddressV4),
            tostring(gd.service.remoteIpDetails.ipAddressV4),
            tostring(gd.service.action.networkConnectionAction.remoteIpDetails.ipAddressV4)
        ),
        RemoteCountry_API = coalesce(
            tostring(gd.service.action.awsApiCallAction.remoteIpDetails.country.countryName),
            tostring(gd.service.remoteIpDetails.country.countryName)
        ),
        RemoteCity_API = coalesce(
            tostring(gd.service.action.awsApiCallAction.remoteIpDetails.city.cityName),
            tostring(gd.service.remoteIpDetails.city.cityName)
        ),
        RemoteOrganization_API = coalesce(
            tostring(gd.service.action.awsApiCallAction.remoteIpDetails.organization.org),
            tostring(gd.service.remoteIpDetails.organization.org)
        ),
        RemoteIsp_API = coalesce(
            tostring(gd.service.action.awsApiCallAction.remoteIpDetails.organization.isp),
            tostring(gd.service.remoteIpDetails.organization.isp)
        )
    //
    // Enhanced identity context extraction
    | extend
        // Account and user information
        RemoteAccountId = coalesce(
            tostring(gd.service.action.awsApiCallAction.remoteAccountDetails.accountId),
            tostring(gd.accountId)
        ),
        UserName = coalesce(
            tostring(gd.service.action.awsApiCallAction.remoteAccountDetails.affiliated),
            tostring(gd.resource.accessKeyDetails.userName),
            extract(@"user/([^/]+)", 1, tostring(gd.resource.accessKeyDetails.principalId))
        ),
        AccessKeyId = coalesce(
            tostring(gd.service.action.awsApiCallAction.remoteAccountDetails.accessKeyId),
            tostring(gd.resource.accessKeyDetails.accessKeyId)
        ),
        PrincipalId = coalesce(
            tostring(gd.service.action.awsApiCallAction.remoteAccountDetails.principalId),
            tostring(gd.resource.accessKeyDetails.principalId)
        ),
        SessionName = tostring(gd.service.action.awsApiCallAction.remoteAccountDetails.sessionName),
        // Enhanced user type classification
        UserType = case(
            tostring(gd.resource.accessKeyDetails.userType) == "IAMUser", "IAM User",
            tostring(gd.resource.accessKeyDetails.userType) == "Root", "Root Account",
            tostring(gd.resource.accessKeyDetails.userType) == "AssumedRole", "Assumed Role",
            isnotempty(tostring(gd.service.action.awsApiCallAction.remoteAccountDetails.sessionName)), "Assumed Role",
            isnotempty(tostring(gd.resource.accessKeyDetails.accessKeyId)), "IAM User",
            "Unknown"
        )
    //
    // Enhanced resource context extraction
    | extend
        ResourceArn = coalesce(
            tostring(gd.resource.resourceArn),
            tostring(gd.resource.accessKeyDetails.accessKeyId)
        ),
        ResourceUserName = tostring(gd.resource.accessKeyDetails.userName),
        ResourceUserType = tostring(gd.resource.accessKeyDetails.userType),
        ResourceInstanceId = tostring(gd.resource.instanceDetails.instanceId),
        ResourceInstanceType = tostring(gd.resource.instanceDetails.instanceType)
    //
    // Enhanced action result determination
    | extend ActionResult = case(
        isnotempty(ErrorCode) and ErrorCode != "Success", "Failure",
        ErrorCode == "Success", "Success",
        FindingType has "Unauthorized", "Failure",
        FindingType has "Stealth", "Success", // Stealth activities are typically successful
        isnotempty(ApiName), "Success",
        "Unknown"
    )
    //
    // Enhanced finding categorization with threat intelligence
    | extend FindingCategory = case(
        FindingType has_any("Stealth", "StealthyBehavior"), "Stealth Activity",
        FindingType has_any("Policy", "PolicyViolation"), "Policy Violation",
        FindingType has_any("Credential", "CredentialAccess"), "Credential Compromise",
        FindingType has_any("UnauthorizedAPI", "Unauthorized"), "Unauthorized Access",
        FindingType has_any("Persistence", "PersistentThreat"), "Persistence",
        FindingType has_any("PrivilegeEscalation", "Escalation"), "Privilege Escalation",
        FindingType has_any("Reconnaissance", "Recon"), "Reconnaissance",
        FindingType has_any("Discovery", "Enum"), "Discovery",
        "IAM Activity"
    ),
    // Risk scoring based on finding characteristics
    RiskScore = case(
        SeverityLevel == "High" and ActionResult == "Success", 90,
        SeverityLevel == "High" and ActionResult == "Failure", 70,
        SeverityLevel == "Medium" and ActionResult == "Success", 60,
        SeverityLevel == "Medium" and ActionResult == "Failure", 40,
        SeverityLevel == "Low", 20,
        10
    ),
    // Authentication method inference
    AuthenticationMethod = case(
        isnotempty(SessionName), "Assumed Role",
        isnotempty(AccessKeyId) and UserType == "Root Account", "Root Access Key",
        isnotempty(AccessKeyId), "Access Key",
        "Unknown"
    ),
    // Threat indicators
    ThreatIndicators = case(
        RemoteCountry_API in ("China", "Russia", "North Korea", "Iran"), "High-Risk Geography",
        RemoteOrganization_API has_any("Tor", "VPN", "Proxy"), "Anonymization Service",
        UserAgent has_any("curl", "wget", "python", "boto"), "Programmatic Access",
        ApiName has_any("CreateUser", "AttachUserPolicy", "CreateRole"), "Privilege Operations",
        ""
    )
    //
    // Data quality validation
    | extend DataQuality = case(
        isempty(FindingId), "Missing FindingId",
        isempty(ApiName) and ActionType == "AWS_API_CALL", "Missing API Name",
        isempty(RemoteIp_API) and ActionType == "AWS_API_CALL", "Missing Remote IP",
        "Good"
    )
    //
    // Filter out low-quality records if specified
    | where DataQuality == "Good" or isempty(DataQuality)
    //
    // Project comprehensive IAM-specific fields
    | project 
        TimeGenerated,
        EventTime,
        FindingId,
        FindingType,
        FindingCategory,
        Severity,
        SeverityLevel,
        RiskScore,
        Title,
        Description,
        AwsAccountId,
        AwsRegion,
        // API call details
        ApiName,
        ServiceName_API,
        CallerType,
        ActionResult,
        ErrorCode,
        UserAgent,
        // Enhanced identity context
        RemoteAccountId,
        UserName,
        UserType,
        AccessKeyId,
        PrincipalId,
        SessionName,
        AuthenticationMethod,
        // Resource context
        ResourceArn,
        ResourceUserName,
        ResourceUserType,
        ResourceInstanceId,
        ResourceInstanceType,
        // Network context
        RemoteIp_API,
        RemoteCountry_API,
        RemoteCity_API,
        RemoteOrganization_API,
        RemoteIsp_API,
        // Threat intelligence
        ThreatIndicators,
        DataQuality,
        RawJson
};
AWSGuardDuty_IAM'''
    functionAlias: 'AWSGuardDuty_IAM'
    functionParameters: 'lookback:timespan=timespan(null)'
  }
}

// ASIM Network Session parser function
resource asimNetworkFunction 'Microsoft.OperationalInsights/workspaces/savedSearches@2020-08-01' = {
  name: '${workspaceName}/AWSGuardDuty_ASIMNetworkSession'
  dependsOn: [networkFunction]
  properties: {
    displayName: 'AWSGuardDuty_ASIMNetworkSession'
    category: 'GuardDuty'
    tags: {
      Environment: environment
      Version: parserVersion
      DeployedAt: deploymentTimestamp
      ASIMCompliant: 'true'
    }
    query: '''// AWSGuardDuty_ASIMNetworkSession
// Enhanced ASIM Network Session aligned parser for GuardDuty network findings
// Maps GuardDuty network data to ASIM Network Session schema v0.2.6
let AWSGuardDuty_ASIMNetworkSession = (lookback: timespan = timespan(null)) {
    AWSGuardDuty_Network(lookback)
    | where isnotempty(RemoteIp)
    //
    // ASIM Network Session Schema Mapping v0.2.6
    | extend
        // Event fields - Core ASIM requirements
        EventType = "NetworkSession",
        EventSchemaVersion = "0.2.6",
        EventVendor = "AWS",
        EventProduct = "GuardDuty",
        EventProductVersion = "1.0",
        EventCount = int(1),
        EventStartTime = EventTime,
        EventEndTime = EventTime,
        EventResult = "Success",  // GuardDuty detects successful connections
        EventSeverity = SeverityLevel,
        EventOriginalSeverity = tostring(Severity),
        EventMessage = Title,
        EventOriginalType = FindingType,
        EventOriginalUid = FindingId,
        EventUid = strcat("guardduty-", FindingId),
        //
        // Source fields (AWS resource) - Enhanced mapping
        SrcIpAddr = coalesce(PrivateIp, LocalIp, ""),
        SrcPortNumber = toint(coalesce(LocalPort, 0)),
        SrcHostname = coalesce(InstanceId, ""),
        SrcDvcId = coalesce(InstanceId, ""),
        SrcDvcIdType = case(
            isnotempty(InstanceId), "Other",
            ""
        ),
        SrcGeoCountry = AwsRegion,
        SrcGeoRegion = AwsRegion,
        SrcDomain = coalesce(VpcId, ""),
        SrcDomainType = case(
            isnotempty(VpcId), "Other",
            ""
        ),
        //
        // Destination fields (remote endpoint) - Enhanced with threat intelligence
        DstIpAddr = RemoteIp,
        DstPortNumber = toint(coalesce(RemotePort, 0)),
        DstGeoCountry = coalesce(RemoteCountry, ""),
        DstGeoCity = coalesce(RemoteCity, ""),
        DstGeoRegion = coalesce(RemoteCountry, ""),
        DstHostname = coalesce(DomainName, ""),
        // Enhanced threat categorization for destination
        DstRiskLevel = case(
            ThreatCategory == "High Risk", 90,
            ThreatCategory == "Medium Risk", 60,
            ThreatCategory == "Low Risk", 30,
            SeverityLevel == "High", 80,
            SeverityLevel == "Medium", 50,
            SeverityLevel == "Low", 20,
            10
        ),
        //
        // Network fields - Enhanced protocol and direction mapping
        NetworkProtocol = case(
            Protocol == "TCP", "TCP",
            Protocol == "UDP", "UDP",
            Protocol == "ICMP", "ICMP",
            toupper(Protocol)
        ),
        NetworkDirection = case(
            TrafficDirection == "INBOUND", "Inbound",
            TrafficDirection == "OUTBOUND", "Outbound",
            TrafficDirection == "INTERNAL", "Internal",
            TrafficDirection == "UNKNOWN", "Unknown",
            "Unknown"
        ),
        NetworkSessionId = FindingId,
        NetworkBytes = toint(0), // GuardDuty doesn't provide byte counts
        NetworkPackets = toint(0), // GuardDuty doesn't provide packet counts
        NetworkApplicationProtocol = case(
            DstPortNumber == 80, "HTTP",
            DstPortNumber == 443, "HTTPS",
            DstPortNumber == 53, "DNS",
            DstPortNumber == 22, "SSH",
            DstPortNumber == 3389, "RDP",
            DstPortNumber == 25, "SMTP",
            DstPortNumber == 21, "FTP",
            ""
        ),
        //
        // Device fields - Enhanced AWS context
        DvcId = coalesce(InstanceId, ""),
        DvcIdType = case(
            isnotempty(InstanceId), "Other",
            ""
        ),
        DvcHostname = coalesce(InstanceId, ""),
        DvcOs = case(
            Platform == "windows", "Windows",
            Platform == "linux", "Linux",
            isnotempty(Platform), Platform,
            "Linux"  // Default assumption for EC2
        ),
        DvcOsVersion = "",
        DvcAction = "Allow", // GuardDuty detects allowed traffic
        DvcInterface = coalesce(NetworkInterface, ""),
        //
        // Enhanced threat fields with intelligence
        ThreatName = FindingType,
        ThreatCategory = case(
            FindingType has_any("Backdoor", "Trojan"), "Malware",
            FindingType has_any("CryptoCurrency", "Mining"), "Cryptocurrency",
            FindingType has_any("DNS", "DomainGeneration"), "DNS",
            FindingType has_any("Recon", "PortProbe"), "Reconnaissance",
            FindingType has_any("Brute", "Dictionary"), "Brute Force",
            ThreatCategory // Use enhanced category from Network parser
        ),
        ThreatRiskLevel = case(
            SeverityLevel == "High", 90,
            SeverityLevel == "Medium", 60,
            SeverityLevel == "Low", 30,
            SeverityLevel == "Informational", 10,
            toint(Severity * 10)
        ),
        ThreatOriginalRiskLevel = tostring(Severity),
        ThreatField = case(
            isnotempty(RemoteIp), "DstIpAddr",
            isnotempty(DomainName), "DstHostname",
            ""
        ),
        ThreatIpAddr = RemoteIp,
        ThreatIsActive = true,
        ThreatFirstReportedTime = EventTime,
        ThreatLastReportedTime = EventTime,
        //
        // Rule and detection fields
        RuleName = FindingType,
        RuleNumber = toint(0),
        RuleAction = "Alert",
        //
        // Enhanced additional context with AWS-specific fields
        AdditionalFields = bag_pack(
            "AwsAccountId", AwsAccountId,
            "AwsRegion", AwsRegion,
            "VpcId", VpcId,
            "SubnetId", SubnetId,
            "InstanceId", InstanceId,
            "InstanceType", InstanceType,
            "SecurityGroupId", SecurityGroupId,
            "NetworkInterface", NetworkInterface,
            "RemoteOrganization", RemoteOrganization,
            "RemoteIsp", RemoteIsp,
            "RemoteAsn", RemoteAsn,
            "ThreatListName", ThreatListName,
            "GuardDutyFindingId", FindingId,
            "GuardDutyService", "GuardDuty",
            "Platform", Platform,
            "Architecture", Architecture,
            "ImageId", ImageId,
            "LaunchTime", LaunchTime
        )
    //
    // Data quality validation for ASIM compliance
    | extend ASIMCompliance = case(
        isempty(SrcIpAddr) and isempty(DstIpAddr), "Missing IP addresses",
        isempty(NetworkProtocol), "Missing protocol",
        isempty(EventTime), "Missing timestamp",
        "Compliant"
    )
    //
    // Filter for ASIM compliance (optional - can be disabled for debugging)
    | where ASIMCompliance == "Compliant"
    //
    // Project ASIM Network Session fields in standard order
    | project 
        // Standard ASIM Event fields
        TimeGenerated,
        EventType,
        EventSchemaVersion,
        EventVendor,
        EventProduct,
        EventProductVersion,
        EventCount,
        EventStartTime,
        EventEndTime,
        EventResult,
        EventSeverity,
        EventOriginalSeverity,
        EventMessage,
        EventOriginalType,
        EventOriginalUid,
        EventUid,
        //
        // Network Session specific fields
        SrcIpAddr,
        SrcPortNumber,
        SrcHostname,
        SrcDvcId,
        SrcDvcIdType,
        SrcGeoCountry,
        SrcGeoRegion,
        SrcDomain,
        SrcDomainType,
        DstIpAddr,
        DstPortNumber,
        DstGeoCountry,
        DstGeoCity,
        DstGeoRegion,
        DstHostname,
        DstRiskLevel,
        NetworkProtocol,
        NetworkDirection,
        NetworkSessionId,
        NetworkBytes,
        NetworkPackets,
        NetworkApplicationProtocol,
        //
        // Device information
        DvcId,
        DvcIdType,
        DvcHostname,
        DvcOs,
        DvcOsVersion,
        DvcAction,
        DvcInterface,
        //
        // Enhanced threat information
        ThreatName,
        ThreatCategory,
        ThreatRiskLevel,
        ThreatOriginalRiskLevel,
        ThreatField,
        ThreatIpAddr,
        ThreatIsActive,
        ThreatFirstReportedTime,
        ThreatLastReportedTime,
        //
        // Rule information
        RuleName,
        RuleNumber,
        RuleAction,
        //
        // Additional AWS context
        AdditionalFields,
        //
        // Quality and compliance
        ASIMCompliance,
        //
        // Original data for reference
        RawJson
};
AWSGuardDuty_ASIMNetworkSession'''
    functionAlias: 'AWSGuardDuty_ASIMNetworkSession'
    functionParameters: 'lookback:timespan=timespan(null)'
  }
}

// Deployment validation outputs
output deploymentSummary object = {
  workspaceName: workspaceName
  resourceGroupName: resourceGroupName
  environment: environment
  parserVersion: parserVersion
  schemaVersion: schemaVersion
  deploymentTimestamp: deploymentTimestamp
  configuration: {
    guardDutyTableName: guardDutyTableName
    rawDataColumn: rawDataColumn
    alternateRawDataColumn: validatedAlternateColumn
    defaultLookback: defaultLookback
    maxLookback: maxLookback
    enableGeoEnrichment: enableGeoEnrichment
    enableASIMNormalization: enableASIMNormalization
    enableDataValidation: enableDataValidation
  }
}

output deployedFunctions array = [
  'AWSGuardDuty_Config'
  'AWSGuardDuty_Schema'
  'AWSGuardDuty_Main'
  'AWSGuardDuty_Network'
  'AWSGuardDuty_IAM'
  'AWSGuardDuty_ASIMNetworkSession'
]

output validationQueries array = [
  'AWSGuardDuty_Config() | take 10'
  'AWSGuardDuty_Schema(1d) | summarize count() by QualityCategory'
  'AWSGuardDuty_Main(1d) | take 5'
  'AWSGuardDuty_Network(1d) | where isnotempty(RemoteIp) | take 5'
  'AWSGuardDuty_IAM(1d) | where isnotempty(ApiName) | take 5'
  'AWSGuardDuty_ASIMNetworkSession(1d) | take 5'
]

output nextSteps array = [
  '1. Run validation queries to verify deployment'
  '2. Check data ingestion: AWSGuardDuty | getschema'
  '3. Validate connector: Run smoke tests from validation/smoke_tests.kql'
  '4. Review troubleshooting guide if issues occur'
  '5. Configure alerting rules based on parsed data'
]