"""
GuardDuty → Sentinel Ingestion Handler
========================================
AWS Lambda function that receives GuardDuty findings via EventBridge,
transforms them, and posts to Microsoft Sentinel via the Log Analytics
Data Collector API.

Architecture:
  EventBridge Rule → Lambda → Log Analytics HTTP Data Collector API → Sentinel

This provides a direct-push alternative to the S3/SQS polling connector,
useful for real-time alerting or environments where the S3 connector
has latency constraints.
"""

import os
import json
import hashlib
import hmac
import base64
import datetime
import logging
from typing import Any

import urllib.request
import urllib.error

# ─── Configuration via Environment Variables ────────────────────────────────────

WORKSPACE_ID = os.environ["SENTINEL_WORKSPACE_ID"]
SHARED_KEY = os.environ["SENTINEL_SHARED_KEY"]
LOG_TYPE = os.environ.get("LOG_TYPE", "AWSGuardDuty")
AWS_REGION = os.environ.get("AWS_REGION", "eu-west-2")

# ─── Logging Setup ──────────────────────────────────────────────────────────────

logger = logging.getLogger(__name__)
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))


# ─── Sentinel API Authentication ────────────────────────────────────────────────

def build_signature(
    workspace_id: str,
    shared_key: str,
    date: str,
    content_length: int,
    method: str = "POST",
    content_type: str = "application/json",
    resource: str = "/api/logs",
) -> str:
    """Build the HMAC-SHA256 authorization header for Log Analytics API."""
    x_headers = f"x-ms-date:{date}"
    string_to_hash = (
        f"{method}\n{content_length}\n{content_type}\n{x_headers}\n{resource}"
    )
    bytes_to_hash = string_to_hash.encode("utf-8")
    decoded_key = base64.b64decode(shared_key)
    encoded_hash = base64.b64encode(
        hmac.new(decoded_key, bytes_to_hash, digestmod=hashlib.sha256).digest()
    ).decode("utf-8")
    return f"SharedKey {workspace_id}:{encoded_hash}"


def post_to_sentinel(body: str, log_type: str) -> int:
    """
    Post JSON payload to the Log Analytics Data Collector API.

    Returns:
        HTTP status code (200 = accepted, 4xx/5xx = error)

    Raises:
        urllib.error.URLError on network failures
    """
    rfc1123_date = datetime.datetime.utcnow().strftime("%a, %d %b %Y %H:%M:%S GMT")
    content_length = len(body)

    signature = build_signature(
        WORKSPACE_ID, SHARED_KEY, rfc1123_date, content_length
    )

    uri = (
        f"https://{WORKSPACE_ID}.ods.opinsights.azure.com"
        f"/api/logs?api-version=2016-04-01"
    )

    headers = {
        "Content-Type": "application/json",
        "Authorization": signature,
        "Log-Type": log_type,
        "x-ms-date": rfc1123_date,
        "time-generated-field": "TimeGenerated",
    }

    req = urllib.request.Request(uri, data=body.encode("utf-8"), headers=headers)
    with urllib.request.urlopen(req) as response:
        return response.getcode()


# ─── GuardDuty Event Parsing & Transformation ───────────────────────────────────

def parse_guardduty_finding(event: dict[str, Any]) -> dict[str, Any]:
    """
    Parse a GuardDuty finding from EventBridge format into a flat,
    Sentinel-friendly schema.

    Handles both:
      - Direct format (schemaVersion at root)
      - EventBridge envelope (finding nested under 'detail')
    """
    # Unwrap EventBridge envelope if present
    if event.get("detail-type") == "GuardDuty Finding":
        finding = event["detail"]
    elif "schemaVersion" in event:
        finding = event
    else:
        raise ValueError(f"Unrecognized event format: {list(event.keys())[:5]}")

    # ── Core fields ──────────────────────────────────────────────────────────
    severity_raw = finding.get("severity", 0)
    severity_level = (
        "Critical" if severity_raw >= 8.5 else
        "High" if severity_raw >= 7.0 else
        "Medium" if severity_raw >= 4.0 else
        "Low" if severity_raw >= 1.0 else
        "Informational"
    )

    # ── Network context extraction ───────────────────────────────────────────
    action = finding.get("service", {}).get("action", {})
    action_type = action.get("actionType", "")
    network = action.get("networkConnectionAction", {})
    api_call = action.get("awsApiCallAction", {})

    remote_ip = (
        network.get("remoteIpDetails", {}).get("ipAddressV4")
        or api_call.get("remoteIpDetails", {}).get("ipAddressV4")
    )
    remote_country = (
        network.get("remoteIpDetails", {}).get("country", {}).get("countryName")
        or api_call.get("remoteIpDetails", {}).get("country", {}).get("countryName")
    )

    # ── Resource context ─────────────────────────────────────────────────────
    resource = finding.get("resource", {})
    resource_type = resource.get("resourceType", "")
    instance = resource.get("instanceDetails", {})
    access_key = resource.get("accessKeyDetails", {})

    # ── Build normalized record ──────────────────────────────────────────────
    return {
        "TimeGenerated": finding.get("updatedAt", finding.get("createdAt")),
        "FindingId": finding.get("id"),
        "FindingType": finding.get("type"),
        "Severity": severity_raw,
        "SeverityLevel": severity_level,
        "Title": finding.get("title"),
        "Description": finding.get("description"),
        "AwsAccountId": finding.get("accountId"),
        "AwsRegion": finding.get("region", AWS_REGION),
        "SchemaVersion": finding.get("schemaVersion"),
        "ResourceType": resource_type,
        "ActionType": action_type,
        # Network context
        "RemoteIp": remote_ip,
        "RemoteCountry": remote_country,
        "Protocol": network.get("protocol"),
        "ConnectionDirection": network.get("connectionDirection"),
        "RemotePort": network.get("remotePortDetails", {}).get("port"),
        "LocalPort": network.get("localPortDetails", {}).get("port"),
        # IAM context
        "ApiName": api_call.get("api"),
        "CallerType": api_call.get("callerType"),
        "UserName": access_key.get("userName"),
        "UserType": access_key.get("userType"),
        "AccessKeyId": access_key.get("accessKeyId"),
        # Instance context
        "InstanceId": instance.get("instanceId"),
        "InstanceType": instance.get("instanceType"),
        "VpcId": (instance.get("networkInterfaces") or [{}])[0].get("vpcId"),
        # Service metadata
        "DetectorId": finding.get("service", {}).get("detectorId"),
        "EventFirstSeen": finding.get("service", {}).get("eventFirstSeen"),
        "EventLastSeen": finding.get("service", {}).get("eventLastSeen"),
        # Raw JSON for full traceability
        "RawFinding": json.dumps(finding),
    }


# ─── Lambda Handler ──────────────────────────────────────────────────────────────

def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """
    AWS Lambda entry point.

    Receives GuardDuty findings from EventBridge, parses and transforms them,
    then posts to Microsoft Sentinel's Log Analytics Data Collector API.

    Returns:
        dict with statusCode and processing summary
    """
    logger.info(
        "Processing GuardDuty event",
        extra={"detail_type": event.get("detail-type"), "source": event.get("source")},
    )

    try:
        # ── Parse the finding ────────────────────────────────────────────────
        normalized = parse_guardduty_finding(event)
        finding_type = normalized.get("FindingType", "Unknown")
        severity = normalized.get("SeverityLevel", "Unknown")

        logger.info(
            f"Parsed finding: {finding_type} | Severity: {severity} | "
            f"Account: {normalized.get('AwsAccountId')}"
        )

        # ── Post to Sentinel ─────────────────────────────────────────────────
        payload = json.dumps([normalized])
        status_code = post_to_sentinel(payload, LOG_TYPE)

        if status_code == 200:
            logger.info(
                f"Successfully posted to Sentinel: {finding_type}",
                extra={"finding_id": normalized.get("FindingId")},
            )
            return {
                "statusCode": 200,
                "body": json.dumps({
                    "message": "Finding ingested successfully",
                    "findingId": normalized.get("FindingId"),
                    "findingType": finding_type,
                    "severity": severity,
                }),
            }
        else:
            logger.error(f"Sentinel API returned status {status_code}")
            return {"statusCode": status_code, "body": "Sentinel API error"}

    except ValueError as e:
        # ── Malformed event handling ─────────────────────────────────────────
        logger.error(f"Event parsing failed: {e}", exc_info=True)
        return {
            "statusCode": 400,
            "body": json.dumps({"error": "Malformed GuardDuty event", "detail": str(e)}),
        }

    except urllib.error.HTTPError as e:
        # ── Sentinel API HTTP errors ─────────────────────────────────────────
        error_body = e.read().decode("utf-8", errors="replace")
        logger.error(
            f"Sentinel API HTTP error: {e.code} - {error_body}",
            extra={"status": e.code, "response": error_body},
        )
        return {
            "statusCode": e.code,
            "body": json.dumps({
                "error": "Sentinel API rejected the request",
                "status": e.code,
                "detail": error_body[:500],
            }),
        }

    except urllib.error.URLError as e:
        # ── Network connectivity errors ──────────────────────────────────────
        logger.error(f"Network error posting to Sentinel: {e.reason}", exc_info=True)
        return {
            "statusCode": 502,
            "body": json.dumps({
                "error": "Failed to reach Sentinel API",
                "reason": str(e.reason),
            }),
        }

    except Exception as e:
        # ── Catch-all for unexpected failures ────────────────────────────────
        logger.exception(f"Unexpected error processing GuardDuty finding: {e}")
        return {
            "statusCode": 500,
            "body": json.dumps({
                "error": "Internal processing error",
                "detail": str(e)[:200],
            }),
        }
