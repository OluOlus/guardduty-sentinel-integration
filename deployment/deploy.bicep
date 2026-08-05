@description('Existing Log Analytics workspace name')
param workspaceName string

@description('Environment tag for deployment tracking')
@allowed([
  'dev'
  'test'
  'staging'
  'prod'
])
param environment string = 'prod'

var parserVersion = '1.5.0'
var functions = [
  {
    name: 'AWSGuardDuty_Config'
    parameters: ''
    query: loadTextContent('../kql/AWSGuardDuty_Config.kql')
  }
  {
    name: 'AWSGuardDuty_Main'
    parameters: 'lookback:timespan=timespan(null)'
    query: loadTextContent('../kql/AWSGuardDuty_Main.kql')
  }
  {
    name: 'AWSGuardDuty_Network'
    parameters: 'lookback:timespan=timespan(null)'
    query: loadTextContent('../kql/AWSGuardDuty_Network.kql')
  }
  {
    name: 'AWSGuardDuty_IAM'
    parameters: 'lookback:timespan=timespan(null)'
    query: loadTextContent('../kql/AWSGuardDuty_IAM.kql')
  }
  {
    name: 'AWSGuardDuty_S3'
    parameters: 'lookback:timespan=timespan(null)'
    query: loadTextContent('../kql/AWSGuardDuty_S3.kql')
  }
  {
    name: 'AWSGuardDuty_EKS'
    parameters: 'lookback:timespan=timespan(null)'
    query: loadTextContent('../kql/AWSGuardDuty_EKS.kql')
  }
  {
    name: 'AWSGuardDuty_Malware'
    parameters: 'lookback:timespan=timespan(null)'
    query: loadTextContent('../kql/AWSGuardDuty_Malware.kql')
  }
  {
    name: 'AWSGuardDuty_RDS'
    parameters: 'lookback:timespan=timespan(null)'
    query: loadTextContent('../kql/AWSGuardDuty_RDS.kql')
  }
  {
    name: 'AWSGuardDuty_ASIMNetworkSession'
    parameters: 'lookback:timespan=timespan(null)'
    query: loadTextContent('../kql/AWSGuardDuty_ASIMNetworkSession.kql')
  }
  {
    name: 'AWSGuardDuty_Schema'
    parameters: 'lookback:timespan=timespan(null)'
    query: loadTextContent('../kql/AWSGuardDuty_Schema.kql')
  }
]

resource savedSearches 'Microsoft.OperationalInsights/workspaces/savedSearches@2020-08-01' = [for parser in functions: {
  name: '${workspaceName}/${parser.name}'
  properties: {
    category: 'GuardDuty'
    displayName: parser.name
    functionAlias: parser.name
    functionParameters: parser.parameters
    query: parser.query
    tags: {
      Environment: environment
      Version: parserVersion
    }
  }
}]

output deployedFunctions array = [for parser in functions: parser.name]
