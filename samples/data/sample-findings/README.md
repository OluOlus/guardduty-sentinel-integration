# Sample GuardDuty Findings

This directory contains comprehensive sample GuardDuty findings covering all major finding types, edge cases, and malformed data for testing purposes.

## Structure

- `ec2-findings/` - EC2 instance-related findings
- `s3-findings/` - S3 bucket-related findings
- `iam-findings/` - IAM access key-related findings
- `kubernetes-findings/` - EKS/Kubernetes-related findings
- `malware-findings/` - Malware detection findings
- `edge-cases/` - Edge cases and boundary conditions
- `malformed/` - Malformed and invalid findings for error testing

## Usage

These samples are used by:
- Unit tests for data transformation validation
- Property-based test generators
- Integration tests for end-to-end workflows
- Manual testing and development

## Finding Types Covered

### EC2 Findings
- Trojan:EC2/DNSDataExfiltration
- Backdoor:EC2/C&CActivity.B!DNS
- CryptoCurrency:EC2/BitcoinTool.B!DNS
- Trojan:EC2/BlackholeTraffic
- Behavior:EC2/NetworkPortUnusual
- UnauthorizedAccess:EC2/TorIPCaller
- Recon:EC2/PortProbeUnprotectedPort

### S3 Findings
- Policy:S3/BucketBlockPublicAccessDisabled
- PenTest:S3/KaliLinux
- UnauthorizedAccess:S3/TorIPCaller
- Exfiltration:S3/ObjectRead.Unusual
- Impact:S3/PermissionsModification.Unusual

### IAM Findings
- Stealth:IAMUser/CloudTrailLoggingDisabled
- PenTest:IAMUser/KaliLinux
- UnauthorizedAccess:IAMUser/TorIPCaller
- Persistence:IAMUser/NetworkPermissions
- PrivilegeEscalation:IAMUser/AdministrativePermissions

### Kubernetes Findings
- Execution:Kubernetes/ExecInKubeSystemPod
- PrivilegeEscalation:Kubernetes/PrivilegedContainer
- Persistence:Kubernetes/ContainerWithSensitiveMount
- Discovery:Kubernetes/SuccessfulAnonymousAccess

### Malware Findings
- Execution:Runtime/NewBinaryExecuted
- Execution:Runtime/ModifiedBinaryFile
- CryptoCurrency:Runtime/BitcoinTool
- Trojan:Runtime/BlackholeTraffic