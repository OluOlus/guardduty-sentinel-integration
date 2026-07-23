"""GuardDuty EventBridge to Microsoft Sentinel ingestion.

The default transport is Azure Monitor's Logs Ingestion API. Set
``INGESTION_MODE=legacy`` only while migrating an existing deployment that
still uses the Log Analytics Data Collector API.

EventBridge invokes Lambda asynchronously. Processing and delivery failures
therefore deliberately escape the handler so Lambda retry and on-failure
destinations can work.
"""

from __future__ import annotations

import base64
import datetime
import hashlib
import hmac
import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterable, Iterator, Sequence
from typing import Any, Optional


LOG_TYPE = os.environ.get("LOG_TYPE", "AWSGuardDutyDirect")
AWS_REGION = os.environ.get("AWS_REGION", "")
INGESTION_MODE = os.environ.get("INGESTION_MODE", "dcr").lower()
MAX_RETRIES = int(os.environ.get("MAX_RETRIES", "3"))
BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "25"))
MAX_BATCH_BYTES = int(os.environ.get("MAX_BATCH_BYTES", "900000"))
REQUEST_TIMEOUT_SECONDS = float(os.environ.get("REQUEST_TIMEOUT_SECONDS", "15"))
RETRYABLE_STATUS_CODES = frozenset({408, 425, 429, 500, 502, 503, 504})

logger = logging.getLogger(__name__)
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

_cached_access_token: tuple[str, float] | None = None


def get_required_env(name: str) -> str:
    """Return a required environment variable with a clear runtime error."""
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _utc_rfc1123() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime(
        "%a, %d %b %Y %H:%M:%S GMT"
    )


def build_signature(
    workspace_id: str,
    shared_key: str,
    date: str,
    content_length: int,
    method: str = "POST",
    content_type: str = "application/json",
    resource: str = "/api/logs",
) -> str:
    """Build the legacy Data Collector API HMAC authorization header."""
    string_to_hash = (
        f"{method}\n{content_length}\n{content_type}\n"
        f"x-ms-date:{date}\n{resource}"
    )
    decoded_key = base64.b64decode(shared_key, validate=True)
    digest = hmac.new(
        decoded_key, string_to_hash.encode("utf-8"), hashlib.sha256
    ).digest()
    return f"SharedKey {workspace_id}:{base64.b64encode(digest).decode('ascii')}"


def _retry_delay(error: BaseException, attempt: int) -> float:
    if isinstance(error, urllib.error.HTTPError) and error.headers:
        retry_after = error.headers.get("Retry-After")
        if retry_after:
            try:
                return min(max(float(retry_after), 0.0), 30.0)
            except ValueError:
                pass
    return min(2 ** attempt, 30)


def _is_retryable(error: BaseException) -> bool:
    if isinstance(error, urllib.error.HTTPError):
        return error.code in RETRYABLE_STATUS_CODES
    return isinstance(error, urllib.error.URLError)


def _open_with_retry(
    request: urllib.request.Request,
    *,
    max_attempts: int | None = None,
    timeout: float | None = None,
) -> int:
    """Send a request, retrying only transient HTTP and network failures."""
    attempts = max_attempts if max_attempts is not None else MAX_RETRIES
    if attempts < 1:
        raise ValueError("MAX_RETRIES must be at least 1")

    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(
                request,
                timeout=timeout if timeout is not None else REQUEST_TIMEOUT_SECONDS,
            ) as response:
                return response.getcode()
        except (urllib.error.HTTPError, urllib.error.URLError) as error:
            if not _is_retryable(error) or attempt == attempts - 1:
                raise
            delay = _retry_delay(error, attempt)
            logger.warning(
                "Transient ingestion failure; retrying",
                extra={"attempt": attempt + 1, "delay_seconds": delay},
            )
            time.sleep(delay)

    raise AssertionError("retry loop exited unexpectedly")


def post_to_sentinel(
    body: str,
    log_type: str,
    workspace_id: Optional[str] = None,
    shared_key: Optional[str] = None,
) -> int:
    """Post to the legacy Data Collector API.

    This compatibility path is deprecated by Microsoft and must be selected
    explicitly with ``INGESTION_MODE=legacy``.
    """
    workspace_id = workspace_id or get_required_env("SENTINEL_WORKSPACE_ID")
    shared_key = shared_key or get_required_env("SENTINEL_SHARED_KEY")
    body_bytes = body.encode("utf-8")
    rfc1123_date = _utc_rfc1123()
    signature = build_signature(
        workspace_id, shared_key, rfc1123_date, len(body_bytes)
    )
    request = urllib.request.Request(
        (
            f"https://{workspace_id}.ods.opinsights.azure.com"
            "/api/logs?api-version=2016-04-01"
        ),
        data=body_bytes,
        headers={
            "Content-Type": "application/json",
            "Authorization": signature,
            "Log-Type": log_type,
            "x-ms-date": rfc1123_date,
            "time-generated-field": "TimeGenerated",
        },
        method="POST",
    )
    return _open_with_retry(request)


def _get_access_token() -> str:
    """Get and briefly cache an Entra client-credentials access token."""
    global _cached_access_token

    now = time.time()
    if _cached_access_token and _cached_access_token[1] > now + 60:
        return _cached_access_token[0]

    tenant_id = get_required_env("AZURE_TENANT_ID")
    token_url = os.environ.get(
        "AZURE_TOKEN_ENDPOINT",
        f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token",
    )
    form = urllib.parse.urlencode(
        {
            "client_id": get_required_env("AZURE_CLIENT_ID"),
            "client_secret": get_required_env("AZURE_CLIENT_SECRET"),
            "scope": "https://monitor.azure.com/.default",
            "grant_type": "client_credentials",
        }
    ).encode("ascii")
    request = urllib.request.Request(
        token_url,
        data=form,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        token_response = json.loads(response.read().decode("utf-8"))

    token = token_response.get("access_token")
    if not token:
        raise RuntimeError("Azure token response did not contain access_token")
    expires_in = int(token_response.get("expires_in", 3600))
    _cached_access_token = (token, now + expires_in)
    return token


def post_to_logs_ingestion(
    body: str,
    *,
    endpoint: str | None = None,
    dcr_immutable_id: str | None = None,
    stream_name: str | None = None,
    access_token: str | None = None,
) -> int:
    """Post a JSON array to the Azure Monitor Logs Ingestion API."""
    endpoint = (
        endpoint or get_required_env("AZURE_LOGS_INGESTION_ENDPOINT")
    ).rstrip("/")
    dcr_immutable_id = dcr_immutable_id or get_required_env(
        "AZURE_DCR_IMMUTABLE_ID"
    )
    stream_name = stream_name or os.environ.get(
        "AZURE_DCR_STREAM_NAME", "Microsoft-AWSGuardDuty"
    )
    access_token = access_token or _get_access_token()
    url = (
        f"{endpoint}/dataCollectionRules/"
        f"{urllib.parse.quote(dcr_immutable_id, safe='')}/streams/"
        f"{urllib.parse.quote(stream_name, safe='-_.')}"
        "?api-version=2023-01-01"
    )
    request = urllib.request.Request(
        url,
        data=body.encode("utf-8"),
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    return _open_with_retry(request)


def unwrap_guardduty_finding(event: dict[str, Any]) -> dict[str, Any]:
    """Return the finding from a direct object or EventBridge envelope."""
    if event.get("detail-type") == "GuardDuty Finding":
        if event.get("source") not in (None, "aws.guardduty"):
            raise ValueError("GuardDuty EventBridge source must be aws.guardduty")
        finding = event.get("detail")
        if not isinstance(finding, dict):
            raise ValueError("EventBridge detail must be an object")
        return finding
    if "schemaVersion" in event:
        return event
    raise ValueError(f"Unrecognized event format: {list(event.keys())[:5]}")


def validate_guardduty_finding(finding: dict[str, Any]) -> None:
    """Validate the stable required fields from the AWS Finding contract."""
    required = (
        "accountId",
        "arn",
        "createdAt",
        "id",
        "region",
        "resource",
        "schemaVersion",
        "severity",
        "type",
        "updatedAt",
    )
    missing = [name for name in required if finding.get(name) in (None, "")]
    if missing:
        raise ValueError(
            "GuardDuty finding is missing required fields: " + ", ".join(missing)
        )
    if not isinstance(finding["resource"], dict):
        raise ValueError("GuardDuty resource must be an object")
    severity = finding["severity"]
    if isinstance(severity, bool) or not isinstance(severity, (int, float)):
        raise ValueError("GuardDuty severity must be numeric")
    if not 0 <= severity <= 10:
        raise ValueError("GuardDuty severity must be between 0 and 10")


def severity_level(severity: float) -> str:
    """Map AWS's documented numeric severity ranges."""
    if severity >= 9.0:
        return "Critical"
    if severity >= 7.0:
        return "High"
    if severity >= 4.0:
        return "Medium"
    if severity >= 1.0:
        return "Low"
    return "Informational"


def parse_guardduty_finding(event: dict[str, Any]) -> dict[str, Any]:
    """Transform a GuardDuty finding into the legacy custom-table record."""
    finding = unwrap_guardduty_finding(event)
    validate_guardduty_finding(finding)
    severity = float(finding["severity"])
    service = finding.get("service") or {}
    action = service.get("action") or {}
    network = action.get("networkConnectionAction") or {}
    api_call = action.get("awsApiCallAction") or {}
    resource = finding["resource"]
    instance = resource.get("instanceDetails") or {}
    access_key = resource.get("accessKeyDetails") or {}
    interfaces = instance.get("networkInterfaces") or [{}]
    if not isinstance(interfaces, list) or not interfaces:
        interfaces = [{}]

    remote_ip_details = (
        network.get("remoteIpDetails")
        or api_call.get("remoteIpDetails")
        or {}
    )
    return {
        "TimeGenerated": finding.get("updatedAt") or finding["createdAt"],
        "FindingId": finding["id"],
        "FindingType": finding["type"],
        "Severity": severity,
        "SeverityLevel": severity_level(severity),
        "Title": finding.get("title"),
        "Description": finding.get("description"),
        "AwsAccountId": finding["accountId"],
        "AwsRegion": finding.get("region") or AWS_REGION,
        "SchemaVersion": finding["schemaVersion"],
        "ResourceType": resource.get("resourceType"),
        "ActionType": action.get("actionType"),
        "RemoteIp": remote_ip_details.get("ipAddressV4"),
        "RemoteCountry": (remote_ip_details.get("country") or {}).get(
            "countryName"
        ),
        "Protocol": network.get("protocol"),
        "ConnectionDirection": network.get("connectionDirection"),
        "RemotePort": (network.get("remotePortDetails") or {}).get("port"),
        "LocalPort": (network.get("localPortDetails") or {}).get("port"),
        "ApiName": api_call.get("api"),
        "CallerType": api_call.get("callerType"),
        "UserName": access_key.get("userName"),
        "UserType": access_key.get("userType"),
        "AccessKeyId": access_key.get("accessKeyId"),
        "InstanceId": instance.get("instanceId"),
        "InstanceType": instance.get("instanceType"),
        "VpcId": (interfaces[0] or {}).get("vpcId"),
        "DetectorId": service.get("detectorId"),
        "EventFirstSeen": service.get("eventFirstSeen"),
        "EventLastSeen": service.get("eventLastSeen"),
        "RawFinding": json.dumps(finding, separators=(",", ":"), sort_keys=True),
    }


def to_azure_guardduty_record(event: dict[str, Any]) -> dict[str, Any]:
    """Map to Microsoft's documented built-in ``AWSGuardDuty`` table schema."""
    finding = unwrap_guardduty_finding(event)
    validate_guardduty_finding(finding)
    return {
        "AccountId": finding["accountId"],
        "ActivityType": finding["type"],
        "Arn": finding["arn"],
        "Description": finding.get("description"),
        "Id": finding["id"],
        "Partition": finding.get("partition", "aws"),
        "Region": finding["region"],
        "ResourceDetails": finding["resource"],
        "SchemaVersion": finding["schemaVersion"],
        "ServiceDetails": finding.get("service") or {},
        # The native Microsoft table contract declares this column as int.
        "Severity": int(float(finding["severity"])),
        "TimeCreated": finding["createdAt"],
        "TimeGenerated": finding["updatedAt"],
        "Title": finding.get("title"),
    }


def _encoded_json(records: Sequence[dict[str, Any]]) -> str:
    return json.dumps(
        records, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    )


def iter_batches(
    records: Iterable[dict[str, Any]],
    *,
    batch_size: int | None = None,
    max_batch_bytes: int | None = None,
) -> Iterator[list[dict[str, Any]]]:
    """Yield batches bounded by record count and UTF-8 payload size."""
    size_limit = batch_size if batch_size is not None else BATCH_SIZE
    byte_limit = (
        max_batch_bytes if max_batch_bytes is not None else MAX_BATCH_BYTES
    )
    if size_limit < 1 or byte_limit < 3:
        raise ValueError("Batch limits must be positive")

    batch: list[dict[str, Any]] = []
    for record in records:
        candidate = [*batch, record]
        if len(_encoded_json([record]).encode("utf-8")) > byte_limit:
            raise ValueError("A single record exceeds MAX_BATCH_BYTES")
        if batch and (
            len(candidate) > size_limit
            or len(_encoded_json(candidate).encode("utf-8")) > byte_limit
        ):
            yield batch
            batch = [record]
        else:
            batch = candidate
    if batch:
        yield batch


def post_batch_to_sentinel(
    records: Sequence[dict[str, Any]],
    log_type: str = LOG_TYPE,
    workspace_id: str | None = None,
    shared_key: str | None = None,
    *,
    mode: str | None = None,
) -> dict[str, Any]:
    """Post every record or raise; partial delivery is never reported as success."""
    selected_mode = (mode or INGESTION_MODE).lower()
    batches_sent = 0
    records_sent = 0
    for batch in iter_batches(records):
        body = _encoded_json(batch)
        if selected_mode == "dcr":
            status = post_to_logs_ingestion(body)
        elif selected_mode == "legacy":
            status = post_to_sentinel(
                body, log_type, workspace_id=workspace_id, shared_key=shared_key
            )
        else:
            raise ValueError(f"Unsupported INGESTION_MODE: {selected_mode}")
        if status < 200 or status >= 300:
            raise RuntimeError(f"Ingestion API returned unexpected status {status}")
        batches_sent += 1
        records_sent += len(batch)
    return {"batches_sent": batches_sent, "records_sent": records_sent}


def _events_from_input(event: dict[str, Any]) -> list[dict[str, Any]]:
    if "findings" not in event:
        return [event]
    findings = event["findings"]
    if not isinstance(findings, list) or not findings:
        raise ValueError("findings must be a non-empty array")
    if not all(isinstance(finding, dict) for finding in findings):
        raise ValueError("every finding must be an object")
    return findings


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """AWS Lambda entry point.

    Exceptions intentionally escape. That is the failure contract required for
    asynchronous Lambda retries, destinations, and dead-letter queues.
    """
    if not isinstance(event, dict):
        raise ValueError("Lambda event must be an object")

    events = _events_from_input(event)
    if INGESTION_MODE == "dcr":
        records = [to_azure_guardduty_record(item) for item in events]
    elif INGESTION_MODE == "legacy":
        records = [parse_guardduty_finding(item) for item in events]
    else:
        raise ValueError(f"Unsupported INGESTION_MODE: {INGESTION_MODE}")

    result = post_batch_to_sentinel(records, mode=INGESTION_MODE)
    logger.info(
        "GuardDuty findings delivered",
        extra={
            "records_sent": result["records_sent"],
            "aws_request_id": getattr(context, "aws_request_id", None),
        },
    )
    return {
        "statusCode": 200,
        "body": json.dumps(
            {
                "message": "Findings ingested successfully",
                **result,
            }
        ),
    }
