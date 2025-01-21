/**
 * Property-based test generators for GuardDuty findings
 * Used for comprehensive testing across all finding types and edge cases
 */

import * as fc from 'fast-check';
import { GuardDutyFinding, GuardDutyResource, GuardDutyService, InstanceDetails, S3BucketDetails, AccessKeyDetails, KubernetesDetails } from '../../src/types/guardduty';

// Common AWS regions for testing
const AWS_REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'eu-west-1', 'eu-west-2', 'eu-central-1',
  'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1'
];

// Common GuardDuty finding types
const FINDING_TYPES = [
  'Trojan:EC2/DNSDataExfiltration',
  'Backdoor:EC2/C&CActivity.B!DNS',
  'CryptoCurrency:EC2/BitcoinTool.B!DNS',
  'Policy:S3/BucketBlockPublicAccessDisabled',
  'Stealth:IAMUser/CloudTrailLoggingDisabled',
  'Execution:Kubernetes/ExecInKubeSystemPod',
  'Execution:Runtime/NewBinaryExecuted',
  'UnauthorizedAccess:EC2/TorIPCaller',
  'Recon:EC2/PortProbeUnprotectedPort',
  'Exfiltration:S3/ObjectRead.Unusual'
];

// Instance types for EC2 findings
const INSTANCE_TYPES = [
  't2.micro', 't2.small', 't2.medium', 't2.large',
  't3.micro', 't3.small', 't3.medium', 't3.large',
  'm5.large', 'm5.xlarge', 'm5.2xlarge',
  'c5.large', 'c5.xlarge', 'c5.2xlarge'
];

// Platforms
const PLATFORMS = ['linux', 'windows'];

/**
 * Generate valid AWS account IDs (12-digit strings)
 */
export const accountIdArbitrary = fc.string({ minLength: 12, maxLength: 12 })
  .filter(s => /^\d{12}$/.test(s));

/**
 * Generate valid GuardDuty finding IDs
 */
export const findingIdArbitrary = fc.string({ minLength: 32, maxLength: 64 })
  .filter(s => /^[a-f0-9]+$/.test(s));

/**
 * Generate valid detector IDs
 */
export const detectorIdArbitrary = fc.string({ minLength: 32, maxLength: 64 })
  .filter(s => /^[a-f0-9]+$/.test(s));

/**
 * Generate valid ISO 8601 timestamps
 */
export const timestampArbitrary = fc.date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') })
  .map(date => date.toISOString());

/**
 * Generate valid severity values (0.0 to 8.9)
 */
export const severityArbitrary = fc.integer({ min: 0, max: 89 }).map(n => n / 10);

/**
 * Generate valid instance details for EC2 findings
 */
export const instanceDetailsArbitrary: fc.Arbitrary<InstanceDetails> = fc.record({
  instanceId: fc.string({ minLength: 10, maxLength: 20 }).map(s => `i-${s}`),
  instanceType: fc.constantFrom(...INSTANCE_TYPES),
  launchTime: timestampArbitrary,
  platform: fc.constantFrom(...PLATFORMS),
  productCodes: fc.array(fc.record({
    code: fc.string({ minLength: 10, maxLength: 30 }),
    productType: fc.constantFrom('marketplace', 'devpay')
  }), { maxLength: 3 }),
  iamInstanceProfile: fc.option(fc.record({
    arn: fc.string().map(s => `arn:aws:iam::123456789012:instance-profile/${s}`),
    id: fc.string({ minLength: 20, maxLength: 30 })
  })),
  networkInterfaces: fc.array(fc.record({
    networkInterfaceId: fc.string().map(s => `eni-${s.substring(0, 8)}`),
    privateDnsName: fc.string().map(s => `ip-10-0-0-${Math.floor(Math.random() * 255)}.ec2.internal`),
    privateIpAddress: fc.string().map(() => `10.0.0.${Math.floor(Math.random() * 255)}`),
    publicDnsName: fc.option(fc.string().map(s => `ec2-${Math.floor(Math.random() * 255)}-${Math.floor(Math.random() * 255)}-${Math.floor(Math.random() * 255)}-${Math.floor(Math.random() * 255)}.compute-1.amazonaws.com`)),
    publicIp: fc.option(fc.string().map(() => `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`)),
    subnetId: fc.string().map(s => `subnet-${s.substring(0, 8)}`),
    vpcId: fc.string().map(s => `vpc-${s.substring(0, 8)}`),
    securityGroups: fc.array(fc.record({
      groupId: fc.string().map(s => `sg-${s.substring(0, 8)}`),
      groupName: fc.constantFrom('default', 'web-servers', 'database', 'ssh-access')
    }), { minLength: 1, maxLength: 5 })
  }), { minLength: 1, maxLength: 2 }),
  tags: fc.array(fc.record({
    key: fc.constantFrom('Name', 'Environment', 'Team', 'Project', 'Owner'),
    value: fc.string({ minLength: 1, maxLength: 50 })
  }), { maxLength: 10 }),
  instanceState: fc.constantFrom('pending', 'running', 'shutting-down', 'terminated', 'stopping', 'stopped'),
  availabilityZone: fc.constantFrom(...AWS_REGIONS).map(region => `${region}${fc.sample(fc.constantFrom('a', 'b', 'c'), 1)[0]}`),
  imageId: fc.string().map(s => `ami-${s.substring(0, 17)}`),
  imageDescription: fc.option(fc.string({ minLength: 10, maxLength: 100 }))
});

/**
 * Generate valid S3 bucket details
 */
export const s3BucketDetailsArbitrary: fc.Arbitrary<S3BucketDetails> = fc.record({
  name: fc.string({ minLength: 3, maxLength: 63 }).filter(s => /^[a-z0-9.-]+$/.test(s)),
  type: fc.constantFrom('Destination', 'Source'),
  arn: fc.string().map(name => `arn:aws:s3:::${name}`),
  createdAt: timestampArbitrary,
  owner: fc.option(fc.record({
    id: fc.string({ minLength: 32, maxLength: 32 })
  })),
  tags: fc.array(fc.record({
    key: fc.string({ minLength: 1, maxLength: 50 }),
    value: fc.string({ minLength: 1, maxLength: 50 })
  }), { maxLength: 10 }),
  defaultServerSideEncryption: fc.option(fc.record({
    encryptionType: fc.constantFrom('SSEAlgorithm', 'KMSAlgorithm'),
    kmsMasterKeyArn: fc.option(fc.string().map(s => `arn:aws:kms:us-east-1:123456789012:key/${s}`))
  })),
  publicAccess: fc.option(fc.record({
    effectivePermission: fc.constantFrom('PUBLIC', 'NOT_PUBLIC'),
    permissionConfiguration: fc.record({
      bucketLevelPermissions: fc.record({
        accessControlList: fc.record({
          allowsPublicReadAccess: fc.boolean(),
          allowsPublicWriteAccess: fc.boolean()
        }),
        bucketPolicy: fc.record({
          allowsPublicReadAccess: fc.boolean(),
          allowsPublicWriteAccess: fc.boolean()
        }),
        blockPublicAccess: fc.record({
          ignorePublicAcls: fc.boolean(),
          restrictPublicBuckets: fc.boolean(),
          blockPublicAcls: fc.boolean(),
          blockPublicPolicy: fc.boolean()
        })
      })
    })
  }))
});

/**
 * Generate valid access key details for IAM findings
 */
export const accessKeyDetailsArbitrary: fc.Arbitrary<AccessKeyDetails> = fc.record({
  accessKeyId: fc.string({ minLength: 16, maxLength: 32 }).map(s => `AKIA${s.toUpperCase()}`),
  principalId: fc.string({ minLength: 15, maxLength: 30 }).map(s => `AIDA${s.toUpperCase()}`),
  userName: fc.string({ minLength: 1, maxLength: 64 }),
  userType: fc.constantFrom('IAMUser', 'Root', 'AssumedRole', 'FederatedUser')
});

/**
 * Generate valid Kubernetes details
 */
export const kubernetesDetailsArbitrary: fc.Arbitrary<KubernetesDetails> = fc.record({
  kubernetesUserDetails: fc.option(fc.record({
    username: fc.string({ minLength: 1, maxLength: 100 }),
    uid: fc.string().map(() => `${fc.sample(fc.hexaString({ minLength: 8, maxLength: 8 }), 1)[0]}-${fc.sample(fc.hexaString({ minLength: 4, maxLength: 4 }), 1)[0]}-${fc.sample(fc.hexaString({ minLength: 4, maxLength: 4 }), 1)[0]}-${fc.sample(fc.hexaString({ minLength: 4, maxLength: 4 }), 1)[0]}-${fc.sample(fc.hexaString({ minLength: 12, maxLength: 12 }), 1)[0]}`),
    groups: fc.array(fc.string({ minLength: 1, maxLength: 100 }), { maxLength: 10 })
  })),
  kubernetesWorkloadDetails: fc.option(fc.record({
    name: fc.string({ minLength: 1, maxLength: 100 }),
    type: fc.constantFrom('Pod', 'Deployment', 'Service', 'ConfigMap'),
    uid: fc.string().map(() => `${fc.sample(fc.hexaString({ minLength: 8, maxLength: 8 }), 1)[0]}-${fc.sample(fc.hexaString({ minLength: 4, maxLength: 4 }), 1)[0]}-${fc.sample(fc.hexaString({ minLength: 4, maxLength: 4 }), 1)[0]}-${fc.sample(fc.hexaString({ minLength: 4, maxLength: 4 }), 1)[0]}-${fc.sample(fc.hexaString({ minLength: 12, maxLength: 12 }), 1)[0]}`),
    namespace: fc.constantFrom('default', 'kube-system', 'kube-public', 'production', 'staging'),
    hostNetwork: fc.boolean(),
    containers: fc.array(fc.record({
      name: fc.string({ minLength: 1, maxLength: 50 }),
      image: fc.string({ minLength: 1, maxLength: 200 }),
      securityContext: fc.option(fc.record({
        privileged: fc.boolean(),
        allowPrivilegeEscalation: fc.boolean()
      }))
    }), { minLength: 1, maxLength: 5 })
  }))
});

/**
 * Generate valid GuardDuty resources
 */
export const guardDutyResourceArbitrary: fc.Arbitrary<GuardDutyResource> = fc.oneof(
  // EC2 Instance resource
  fc.record({
    resourceType: fc.constant('Instance'),
    instanceDetails: instanceDetailsArbitrary
  }),
  // S3 Bucket resource
  fc.record({
    resourceType: fc.constant('S3Bucket'),
    s3BucketDetails: s3BucketDetailsArbitrary
  }),
  // Access Key resource
  fc.record({
    resourceType: fc.constant('AccessKey'),
    accessKeyDetails: accessKeyDetailsArbitrary
  }),
  // EKS Cluster resource
  fc.record({
    resourceType: fc.constant('EKSCluster'),
    kubernetesDetails: kubernetesDetailsArbitrary
  })
);

/**
 * Generate valid GuardDuty service information
 */
export const guardDutyServiceArbitrary = fc.record({
  serviceName: fc.constant('guardduty'),
  detectorId: detectorIdArbitrary,
  action: fc.option(fc.oneof(
    // DNS Request Action
    fc.record({
      actionType: fc.constant('DNS_REQUEST'),
      dnsRequestAction: fc.record({
        domain: fc.domain(),
        protocol: fc.constantFrom('UDP', 'TCP'),
        blocked: fc.boolean()
      })
    }),
    // Network Connection Action
    fc.record({
      actionType: fc.constant('NETWORK_CONNECTION'),
      networkConnectionAction: fc.record({
        connectionDirection: fc.constantFrom('INBOUND', 'OUTBOUND'),
        remoteIpDetails: fc.record({
          ipAddressV4: fc.ipV4(),
          country: fc.option(fc.record({
            countryCode: fc.string({ minLength: 2, maxLength: 2 }),
            countryName: fc.string({ minLength: 2, maxLength: 50 })
          })),
          organization: fc.option(fc.record({
            asn: fc.string({ minLength: 1, maxLength: 10 }),
            asnOrg: fc.string({ minLength: 1, maxLength: 100 }),
            isp: fc.string({ minLength: 1, maxLength: 100 }),
            org: fc.string({ minLength: 1, maxLength: 100 })
          }))
        }),
        protocol: fc.constantFrom('TCP', 'UDP', 'ICMP'),
        blocked: fc.boolean()
      })
    }),
    // AWS API Call Action
    fc.record({
      actionType: fc.constant('AWS_API_CALL'),
      awsApiCallAction: fc.record({
        api: fc.constantFrom('GetObject', 'PutObject', 'DeleteObject', 'ListBucket', 'StopLogging', 'CreateUser'),
        serviceName: fc.constantFrom('s3.amazonaws.com', 'cloudtrail.amazonaws.com', 'iam.amazonaws.com'),
        callerType: fc.constantFrom('Remote IP', 'AWS Service'),
        remoteIpDetails: fc.option(fc.record({
          ipAddressV4: fc.ipV4(),
          country: fc.option(fc.record({
            countryCode: fc.string({ minLength: 2, maxLength: 2 }),
            countryName: fc.string({ minLength: 2, maxLength: 50 })
          }))
        })),
        userAgent: fc.option(fc.string({ minLength: 10, maxLength: 200 }))
      })
    })
  )),
  evidence: fc.option(fc.record({
    threatIntelligenceDetails: fc.array(fc.record({
      threatListName: fc.constantFrom('ProofPoint', 'CrowdStrike', 'Emerging Threats', 'BitcoinAbuse'),
      threatNames: fc.array(fc.string({ minLength: 5, maxLength: 100 }), { minLength: 1, maxLength: 5 })
    }), { maxLength: 3 })
  })),
  archived: fc.boolean(),
  count: fc.integer({ min: 1, max: 1000 }),
  eventFirstSeen: timestampArbitrary,
  eventLastSeen: timestampArbitrary,
  resourceRole: fc.constantFrom('TARGET', 'ACTOR'),
  additionalInfo: fc.option(fc.record({
    value: fc.string(),
    type: fc.constantFrom('default', 'sample', 'test')
  })),
  featureName: fc.option(fc.constantFrom('DnsLogs', 'FlowLogs', 'S3Protection', 'CloudTrail', 'EksAuditLogs', 'RuntimeMonitoring'))
});

/**
 * Generate complete valid GuardDuty findings
 */
export const guardDutyFindingArbitrary = fc.record({
  schemaVersion: fc.constant('2.0'),
  accountId: accountIdArbitrary,
  region: fc.constantFrom(...AWS_REGIONS),
  partition: fc.constant('aws'),
  id: findingIdArbitrary,
  arn: fc.tuple(fc.constantFrom(...AWS_REGIONS), accountIdArbitrary, detectorIdArbitrary, findingIdArbitrary)
    .map(([region, accountId, detectorId, findingId]) => 
      `arn:aws:guardduty:${region}:${accountId}:detector/${detectorId}/finding/${findingId}`),
  type: fc.constantFrom(...FINDING_TYPES),
  resource: guardDutyResourceArbitrary,
  service: guardDutyServiceArbitrary,
  severity: severityArbitrary,
  createdAt: timestampArbitrary,
  updatedAt: timestampArbitrary,
  title: fc.string({ minLength: 5, maxLength: 200 }),
  description: fc.string({ minLength: 20, maxLength: 1000 })
});

/**
 * Generate simplified GuardDuty findings for faster testing
 */
export const simpleGuardDutyFindingArbitrary: fc.Arbitrary<Partial<GuardDutyFinding>> = fc.record({
  schemaVersion: fc.constant('2.0'),
  accountId: fc.constant('123456789012'),
  region: fc.constantFrom('us-east-1', 'us-west-2'),
  partition: fc.constant('aws'),
  id: fc.string({ minLength: 10, maxLength: 20 }),
  arn: fc.constant('arn:aws:guardduty:us-east-1:123456789012:detector/test/finding/test'),
  type: fc.constantFrom('Trojan:EC2/DNSDataExfiltration', 'Policy:S3/BucketBlockPublicAccessDisabled'),
  resource: fc.record({
    resourceType: fc.constantFrom('Instance', 'S3Bucket')
  }),
  service: fc.record({
    serviceName: fc.constant('guardduty'),
    detectorId: fc.constant('test-detector'),
    archived: fc.boolean(),
    count: fc.integer({ min: 1, max: 10 }),
    eventFirstSeen: fc.constant('2024-01-01T00:00:00.000Z'),
    eventLastSeen: fc.constant('2024-01-01T00:00:00.000Z'),
    resourceRole: fc.constantFrom('TARGET', 'ACTOR')
  }),
  severity: fc.constantFrom(1.0, 5.0, 8.0),
  createdAt: fc.constant('2024-01-01T00:00:00.000Z'),
  updatedAt: fc.constant('2024-01-01T00:00:00.000Z'),
  title: fc.string({ minLength: 5, maxLength: 50 }),
  description: fc.string({ minLength: 10, maxLength: 100 })
});

/**
 * Generate malformed GuardDuty findings for error testing
 */
export const malformedGuardDutyFindingArbitrary = fc.oneof(
  // Missing required fields
  fc.record({
    schemaVersion: fc.constant('2.0'),
    accountId: fc.constant('123456789012'),
    // Missing other required fields
  }),
  // Invalid data types
  fc.record({
    schemaVersion: fc.constant('2.0'),
    accountId: fc.integer(), // Should be string
    region: fc.constant('us-east-1'),
    partition: fc.constant('aws'),
    id: fc.constant('test'),
    arn: fc.constant('test'),
    type: fc.constant('test'),
    resource: fc.record({ resourceType: fc.constant('Instance') }),
    service: fc.record({
      serviceName: fc.constant('guardduty'),
      detectorId: fc.constant('test'),
      archived: fc.constant('false'), // Should be boolean
      count: fc.constant('1'), // Should be number
      eventFirstSeen: fc.constant('2024-01-01T00:00:00.000Z'),
      eventLastSeen: fc.constant('2024-01-01T00:00:00.000Z'),
      resourceRole: fc.constant('TARGET')
    }),
    severity: fc.constant('5.0'), // Should be number
    createdAt: fc.constant('2024-01-01T00:00:00.000Z'),
    updatedAt: fc.constant('2024-01-01T00:00:00.000Z'),
    title: fc.constant('Test'),
    description: fc.constant('Test')
  }),
  // Invalid severity range
  fc.record({
    schemaVersion: fc.constant('2.0'),
    accountId: fc.constant('123456789012'),
    region: fc.constant('us-east-1'),
    partition: fc.constant('aws'),
    id: fc.constant('test'),
    arn: fc.constant('test'),
    type: fc.constant('test'),
    resource: fc.record({ resourceType: fc.constant('Instance') }),
    service: fc.record({
      serviceName: fc.constant('guardduty'),
      detectorId: fc.constant('test'),
      archived: fc.boolean(),
      count: fc.constant(1),
      eventFirstSeen: fc.constant('2024-01-01T00:00:00.000Z'),
      eventLastSeen: fc.constant('2024-01-01T00:00:00.000Z'),
      resourceRole: fc.constant('TARGET')
    }),
    severity: fc.float({ min: 10.0, max: 100.0 }), // Invalid range
    createdAt: fc.constant('2024-01-01T00:00:00.000Z'),
    updatedAt: fc.constant('2024-01-01T00:00:00.000Z'),
    title: fc.constant('Test'),
    description: fc.constant('Test')
  })
);

/**
 * Generate edge case findings for boundary testing
 */
export const edgeCaseGuardDutyFindingArbitrary = fc.oneof(
  // Minimal finding with only required fields
  fc.record({
    schemaVersion: fc.constant('2.0'),
    accountId: fc.constant('000000000000'),
    region: fc.constant('us-east-1'),
    partition: fc.constant('aws'),
    id: fc.constant('minimal'),
    arn: fc.constant('arn:aws:guardduty:us-east-1:000000000000:detector/minimal/finding/minimal'),
    type: fc.constant('Test:Minimal/Finding'),
    resource: fc.record({ resourceType: fc.constant('Instance') }),
    service: fc.record({
      serviceName: fc.constant('guardduty'),
      detectorId: fc.constant('minimal'),
      archived: fc.constant(false),
      count: fc.constant(1),
      eventFirstSeen: fc.constant('2024-01-01T00:00:00.000Z'),
      eventLastSeen: fc.constant('2024-01-01T00:00:00.000Z'),
      resourceRole: fc.constant('TARGET')
    }),
    severity: fc.constant(0.0), // Minimum severity
    createdAt: fc.constant('2024-01-01T00:00:00.000Z'),
    updatedAt: fc.constant('2024-01-01T00:00:00.000Z'),
    title: fc.constant('Minimal'),
    description: fc.constant('Minimal finding')
  }),
  // Maximum severity finding
  fc.record({
    schemaVersion: fc.constant('2.0'),
    accountId: fc.constant('999999999999'),
    region: fc.constant('us-east-1'),
    partition: fc.constant('aws'),
    id: fc.constant('maximum'),
    arn: fc.constant('arn:aws:guardduty:us-east-1:999999999999:detector/maximum/finding/maximum'),
    type: fc.constant('Critical:Test/Maximum'),
    resource: fc.record({ resourceType: fc.constant('Instance') }),
    service: fc.record({
      serviceName: fc.constant('guardduty'),
      detectorId: fc.constant('maximum'),
      archived: fc.constant(false),
      count: fc.constant(999),
      eventFirstSeen: fc.constant('2024-01-01T00:00:00.000Z'),
      eventLastSeen: fc.constant('2024-01-01T23:59:59.999Z'),
      resourceRole: fc.constant('TARGET')
    }),
    severity: fc.constant(8.9), // Maximum severity
    createdAt: fc.constant('2024-01-01T00:00:00.000Z'),
    updatedAt: fc.constant('2024-01-01T23:59:59.999Z'),
    title: fc.constant('Maximum Severity Finding'),
    description: fc.constant('This finding has maximum severity for testing boundary conditions')
  }),
  // Unicode content finding
  fc.record({
    schemaVersion: fc.constant('2.0'),
    accountId: fc.constant('123456789012'),
    region: fc.constant('ap-northeast-1'),
    partition: fc.constant('aws'),
    id: fc.constant('unicode-测试-🔒'),
    arn: fc.constant('arn:aws:guardduty:ap-northeast-1:123456789012:detector/unicode/finding/unicode-测试-🔒'),
    type: fc.constant('Test:Unicode/SpecialCharacters'),
    resource: fc.record({ resourceType: fc.constant('Instance') }),
    service: fc.record({
      serviceName: fc.constant('guardduty'),
      detectorId: fc.constant('unicode-测试'),
      archived: fc.constant(false),
      count: fc.constant(1),
      eventFirstSeen: fc.constant('2024-01-01T00:00:00.000Z'),
      eventLastSeen: fc.constant('2024-01-01T00:00:00.000Z'),
      resourceRole: fc.constant('TARGET')
    }),
    severity: fc.constant(5.0),
    createdAt: fc.constant('2024-01-01T00:00:00.000Z'),
    updatedAt: fc.constant('2024-01-01T00:00:00.000Z'),
    title: fc.constant('Unicode Test - 测试 🔒'),
    description: fc.constant('Unicode content: 测试, emoji: 🔒🛡️, special chars: \\n\\t\\r')
  })
);