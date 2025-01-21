/**
 * Core TypeScript interfaces for GuardDuty findings
 * Based on AWS GuardDuty API documentation
 */

export interface GuardDutyFinding {
  schemaVersion: string;
  accountId: string;
  region: string;
  partition: string;
  id: string;
  arn: string;
  type: string;
  resource: GuardDutyResource;
  service: GuardDutyService;
  severity: number;
  createdAt: string;
  updatedAt: string;
  title: string;
  description: string;
}

export interface GuardDutyResource {
  resourceType: string;
  instanceDetails?: InstanceDetails;
  s3BucketDetails?: S3BucketDetails;
  accessKeyDetails?: AccessKeyDetails;
  kubernetesDetails?: KubernetesDetails;
}

export interface InstanceDetails {
  instanceId: string;
  instanceType: string;
  launchTime?: string;
  platform?: string;
  productCodes?: ProductCode[];
  iamInstanceProfile?: IamInstanceProfile;
  networkInterfaces?: NetworkInterface[];
  outpostArn?: string;
  tags?: Tag[];
  instanceState: string;
  availabilityZone: string;
  imageId?: string;
  imageDescription?: string;
}

export interface S3BucketDetails {
  arn?: string;
  name: string;
  type: string;
  createdAt?: string;
  owner?: Owner;
  tags?: Tag[];
  defaultServerSideEncryption?: DefaultServerSideEncryption;
  publicAccess?: PublicAccess;
}

export interface AccessKeyDetails {
  accessKeyId?: string;
  principalId?: string;
  userName?: string;
  userType?: string;
}

export interface KubernetesDetails {
  kubernetesUserDetails?: KubernetesUserDetails;
  kubernetesWorkloadDetails?: KubernetesWorkloadDetails;
}

export interface GuardDutyService {
  serviceName: string;
  detectorId: string;
  action?: Action;
  evidence?: Evidence;
  archived: boolean;
  count: number;
  eventFirstSeen: string;
  eventLastSeen: string;
  resourceRole: string;
  additionalInfo?: AdditionalInfo;
  featureName?: string;
  ebsVolumeScanDetails?: EbsVolumeScanDetails;
  runtimeDetails?: RuntimeDetails;
  detection?: Detection;
}

export interface Action {
  actionType: string;
  awsApiCallAction?: AwsApiCallAction;
  dnsRequestAction?: DnsRequestAction;
  networkConnectionAction?: NetworkConnectionAction;
  portProbeAction?: PortProbeAction;
  kubernetesApiCallAction?: KubernetesApiCallAction;
}

export interface NetworkConnectionAction {
  connectionDirection: string;
  remoteIpDetails: RemoteIpDetails;
  remotePortDetails?: RemotePortDetails;
  localPortDetails?: LocalPortDetails;
  protocol: string;
  blocked: boolean;
}

export interface RemoteIpDetails {
  ipAddressV4: string;
  organization?: Organization;
  country?: Country;
  city?: City;
  geoLocation?: GeoLocation;
}

export interface Country {
  countryCode: string;
  countryName: string;
}

export interface City {
  cityName: string;
}

export interface Organization {
  asn?: string;
  asnOrg?: string;
  isp?: string;
  org?: string;
}

export interface GeoLocation {
  lat?: number;
  lon?: number;
}

export interface RemotePortDetails {
  port: number;
  portName: string;
}

export interface LocalPortDetails {
  port: number;
  portName: string;
}

export interface AwsApiCallAction {
  api: string;
  serviceName: string;
  callerType?: string;
  domainDetails?: DomainDetails;
  errorCode?: string;
  userAgent?: string;
  remoteIpDetails?: RemoteIpDetails;
  remoteAccountDetails?: RemoteAccountDetails;
  affectedResources?: Record<string, string>;
}

export interface DnsRequestAction {
  domain: string;
  protocol?: string;
  blocked?: boolean;
}

export interface PortProbeAction {
  blocked: boolean;
  portProbeDetails: PortProbeDetail[];
}

export interface KubernetesApiCallAction {
  requestUri?: string;
  verb?: string;
  sourceIps?: string[];
  userAgent?: string;
  remoteIpDetails?: RemoteIpDetails;
  statusCode?: number;
  parameters?: string;
}

// Supporting interfaces
export interface ProductCode {
  code?: string;
  productType?: string;
}

export interface IamInstanceProfile {
  arn?: string;
  id?: string;
}

export interface NetworkInterface {
  ipv6Addresses?: string[];
  networkInterfaceId?: string;
  privateDnsName?: string;
  privateIpAddress?: string;
  privateIpAddresses?: PrivateIpAddress[];
  publicDnsName?: string;
  publicIp?: string;
  securityGroups?: SecurityGroup[];
  subnetId?: string;
  vpcId?: string;
}

export interface Tag {
  key?: string;
  value?: string;
}

export interface Owner {
  id?: string;
}

export interface DefaultServerSideEncryption {
  encryptionType?: string;
  kmsMasterKeyArn?: string;
}

export interface PublicAccess {
  permissionConfiguration?: PermissionConfiguration;
  effectivePermission?: string;
}

export interface PermissionConfiguration {
  bucketLevelPermissions?: BucketLevelPermissions;
  accountLevelPermissions?: AccountLevelPermissions;
}

export interface BucketLevelPermissions {
  accessControlList?: AccessControlList;
  bucketPolicy?: BucketPolicy;
  blockPublicAccess?: BlockPublicAccess;
}

export interface AccountLevelPermissions {
  blockPublicAccess?: BlockPublicAccess;
}

export interface AccessControlList {
  allowsPublicReadAccess?: boolean;
  allowsPublicWriteAccess?: boolean;
}

export interface BucketPolicy {
  allowsPublicReadAccess?: boolean;
  allowsPublicWriteAccess?: boolean;
}

export interface BlockPublicAccess {
  ignorePublicAcls?: boolean;
  restrictPublicBuckets?: boolean;
  blockPublicAcls?: boolean;
  blockPublicPolicy?: boolean;
}

export interface KubernetesUserDetails {
  username?: string;
  uid?: string;
  groups?: string[];
}

export interface KubernetesWorkloadDetails {
  name?: string;
  type?: string;
  uid?: string;
  namespace?: string;
  hostNetwork?: boolean;
  containers?: Container[];
  volumes?: Volume[];
}

export interface Container {
  containerRuntime?: string;
  id?: string;
  name?: string;
  image?: string;
  imagePrefix?: string;
  volumeMounts?: VolumeMount[];
  securityContext?: SecurityContext;
}

export interface Volume {
  name?: string;
  hostPath?: HostPath;
}

export interface VolumeMount {
  name?: string;
  mountPath?: string;
}

export interface HostPath {
  path?: string;
}

export interface SecurityContext {
  privileged?: boolean;
  allowPrivilegeEscalation?: boolean;
}

export interface Evidence {
  threatIntelligenceDetails?: ThreatIntelligenceDetail[];
}

export interface ThreatIntelligenceDetail {
  threatListName?: string;
  threatNames?: string[];
}

export interface AdditionalInfo {
  value?: string;
  type?: string;
}

export interface EbsVolumeScanDetails {
  scanId?: string;
  scanStartedAt?: string;
  scanCompletedAt?: string;
  triggerFindingId?: string;
  sources?: string[];
  scanDetections?: ScanDetection[];
}

export interface ScanDetection {
  scannedItemCount?: ScannedItemCount;
  threatsDetectedItemCount?: ThreatsDetectedItemCount;
  highestSeverityThreatDetails?: HighestSeverityThreatDetails;
  threatDetectedByName?: ThreatDetectedByName;
}

export interface RuntimeDetails {
  process?: ProcessDetails;
  context?: RuntimeContext;
}

export interface ProcessDetails {
  name?: string;
  executablePath?: string;
  executableSha256?: string;
  namespacePid?: number;
  pwd?: string;
  pid?: number;
  startTime?: string;
  uuid?: string;
  parentUuid?: string;
  user?: string;
  userId?: number;
  euid?: number;
  lineage?: LineageObject[];
}

export interface RuntimeContext {
  modifyingProcess?: ProcessDetails;
  modifiedAt?: string;
  scriptPath?: string;
  libraryPath?: string;
  ldPreloadValue?: string;
  socketPath?: string;
  runcBinaryPath?: string;
  releaseAgentPath?: string;
  mountSource?: string;
  mountTarget?: string;
  fileSystemType?: string;
  flags?: string;
  moduleName?: string;
  moduleFilePath?: string;
  moduleSha256?: string;
  shellHistoryFilePath?: string;
  targetProcess?: ProcessDetails;
  addressFamily?: string;
  ianaProtocolNumber?: number;
  memoryRegions?: string[];
  toolName?: string;
  toolCategory?: string;
  serviceName?: string;
  commandLineExample?: string;
  threatFilePath?: string;
}

export interface Detection {
  anomaly?: Anomaly;
}

export interface Anomaly {
  profiles?: Record<string, Record<string, ProfileFeature[]>>;
  unusual?: Unusual;
}

export interface ProfileFeature {
  profileType?: string;
  profileSubtype?: string;
  observations?: Observations;
}

export interface Observations {
  text?: string[];
}

export interface Unusual {
  behavior?: Record<string, Record<string, UnusualBehavior>>;
}

export interface UnusualBehavior {
  profileType?: string;
  profileSubtype?: string;
  detections?: Detection[];
  unusual?: string;
}

// Additional supporting interfaces
export interface PrivateIpAddress {
  privateDnsName?: string;
  privateIpAddress?: string;
}

export interface SecurityGroup {
  groupId?: string;
  groupName?: string;
}

export interface DomainDetails {
  domain?: string;
}

export interface RemoteAccountDetails {
  accountId?: string;
  affiliated?: boolean;
}

export interface PortProbeDetail {
  localPortDetails?: LocalPortDetails;
  remoteIpDetails?: RemoteIpDetails;
}

export interface ScannedItemCount {
  totalGb?: number;
  files?: number;
  volumes?: number;
}

export interface ThreatsDetectedItemCount {
  files?: number;
}

export interface HighestSeverityThreatDetails {
  severity?: string;
  threatName?: string;
  count?: number;
}

export interface ThreatDetectedByName {
  itemCount?: number;
  uniqueThreatNameCount?: number;
  shortened?: boolean;
  threatNames?: ThreatName[];
}

export interface ThreatName {
  name?: string;
  severity?: string;
  itemCount?: number;
  filePaths?: FilePath[];
}

export interface FilePath {
  filePath?: string;
  volumeArn?: string;
  hash?: string;
  fileName?: string;
}

export interface LineageObject {
  startTime?: string;
  namespacePid?: number;
  userId?: number;
  name?: string;
  pid?: number;
  uuid?: string;
  executablePath?: string;
  euid?: number;
  parentUuid?: string;
}
