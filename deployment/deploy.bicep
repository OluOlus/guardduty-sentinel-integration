@description('Name of the Log Analytics workspace where GuardDuty data is ingested')
param workspaceName string

@description('Name of the table where GuardDuty findings are stored')
param guardDutyTableName string = 'AWSGuardDuty'

@description('Name of the column containing raw GuardDuty JSON data')
param rawDataColumn string = 'EventData'

@description('Default time range for GuardDuty queries')
param defaultLookback string = '7d'

var parserVersion = '1.0.0'

// Configuration function
resource configFunction 'Microsoft.OperationalInsights/workspaces/savedSearches@2020-08-01' = {
  name: '${workspaceName}/AWSGuardDuty_Config'
  properties: {
    displayName: 'AWSGuardDuty_Config'
    category: 'GuardDuty'
    query: '''
// AWSGuardDuty_Config
// Configuration function for GuardDuty parsers
let AWSGuardDuty_Config = () {
    datatable(
        Setting: string,
        Value: string
    )[
        "TableName", "${guardDutyTableName}",
        "RawColumn", "${rawDataColumn}",
        "DefaultLookback", "${defaultLookback}",
        "ParserVersion", "${parserVersion}"
    ]
};
AWSGuardDuty_Config
'''
    functionAlias: 'AWSGuardDuty_Config'
    functionParameters: ''
  }
}

// Main parser function
resource mainFunction 'Microsoft.OperationalInsights/workspaces/savedSearches@2020-08-01' = {
  name: '${workspaceName}/AWSGuardDuty_Main'
  dependsOn: [configFunction]
  properties: {
    displayName: 'AWSGuardDuty_Main'
    category: 'GuardDuty'
    query: '''
// AWSGuardDuty_Main
// Main parser function for GuardDuty findings
let AWSGuardDuty_Main = (lookback: timespan = timespan(null)) {
    let _lookback = iff(isnull(lookback), 
        totimespan(toscalar(AWSGuardDuty_Config() | where Setting == "DefaultLookback" | project Value)), 
        lookback);
    let _tableName = toscalar(AWSGuardDuty_Config() | where Setting == "TableName" | project Value);
    let _rawColumn = toscalar(AWSGuardDuty_Config() | where Setting == "RawColumn" | project Value);
    //
    table(_tableName)
    | where TimeGenerated >= ago(_lookback)
    | extend RawJson = column_ifexists(_rawColumn, "")
    | where isnotempty(RawJson)
    | extend gd = parse_json(RawJson)
    | where isnotempty(gd)
    //
    | extend
        EventTime = todatetime(gd.createdAt),
        UpdatedTime = todatetime(gd.updatedAt),
        FindingId = tostring(gd.id),
        FindingType = tostring(gd.type),
        Severity = todouble(gd.severity),
        Title = tostring(gd.title),
        Description = tostring(gd.description),
        AwsAccountId = tostring(gd.accountId),
        AwsRegion = tostring(gd.region),
        ServiceName = tostring(gd.service.serviceName),
        ResourceType = tostring(gd.resource.resourceType),
        ActionType = tostring(gd.service.action.actionType)
    //
    | extend SeverityLevel = case(
        Severity >= 7.0, "High",
        Severity >= 4.0, "Medium", 
        Severity >= 1.0, "Low",
        "Informational"
    )
    //
    | project 
        TimeGenerated,
        EventTime,
        UpdatedTime,
        FindingId,
        FindingType,
        Severity,
        SeverityLevel,
        Title,
        Description,
        AwsAccountId,
        AwsRegion,
        ServiceName,
        ResourceType,
        ActionType,
        RawJson,
        gd
};
AWSGuardDuty_Main
'''
    functionAlias: 'AWSGuardDuty_Main'
    functionParameters: 'lookback:timespan=timespan(null)'
  }
}

output workspaceName string = workspaceName
output deployedFunctions array = [
  'AWSGuardDuty_Config'
  'AWSGuardDuty_Main'
]