from __future__ import annotations

import base64
import copy
import io
import json
import urllib.error
from unittest import mock

import pytest
from hypothesis import given
from hypothesis import strategies as st

from conftest import load_handler_module


def context_response(status: int = 200, body: bytes = b""):
    response = mock.Mock()
    response.getcode.return_value = status
    response.read.return_value = body
    response.__enter__ = mock.Mock(return_value=response)
    response.__exit__ = mock.Mock(return_value=None)
    return response


def http_error(module, status: int, headers=None, body: bytes = b"error"):
    return module.urllib.error.HTTPError(
        url="https://example.invalid",
        code=status,
        msg="failure",
        hdrs=headers,
        fp=io.BytesIO(body),
    )


def test_parse_eventbridge_finding(handler_module, eventbridge_event):
    parsed = handler_module.parse_guardduty_finding(eventbridge_event)

    assert parsed["FindingId"] == eventbridge_event["detail"]["id"]
    assert parsed["SeverityLevel"] == "High"
    assert parsed["RemoteIp"] == "203.0.113.10"
    assert parsed["RemotePort"] == 443
    assert parsed["VpcId"] == "vpc-0123456789abcdef0"
    assert json.loads(parsed["RawFinding"])["id"] == parsed["FindingId"]


def test_parse_direct_finding(handler_module, finding):
    parsed = handler_module.parse_guardduty_finding(finding)

    assert parsed == {
        "TimeGenerated": "2026-07-22T18:47:17.000Z",
        "FindingId": "00000000000000000000000000000000",
        "FindingType": "Backdoor:EC2/C&CActivity.B!DNS",
        "Severity": 8.7,
        "SeverityLevel": "High",
        "Title": "Command and control activity",
        "Description": (
            "An EC2 instance is communicating with a known command "
            "and control server."
        ),
        "AwsAccountId": "123456789012",
        "AwsRegion": "us-west-2",
        "SchemaVersion": "2.0",
        "ResourceType": "Instance",
        "ActionType": "NETWORK_CONNECTION",
        "RemoteIp": "203.0.113.10",
        "RemoteCountry": "United States",
        "Protocol": "TCP",
        "ConnectionDirection": "OUTBOUND",
        "RemotePort": 443,
        "LocalPort": 49152,
        "ApiName": None,
        "CallerType": None,
        "UserName": None,
        "UserType": None,
        "AccessKeyId": None,
        "InstanceId": "i-0123456789abcdef0",
        "InstanceType": "t3.micro",
        "VpcId": "vpc-0123456789abcdef0",
        "DetectorId": "12abc34d567e8fa901bc2d34eexample",
        "EventFirstSeen": "2026-07-22T18:41:17.000Z",
        "EventLastSeen": "2026-07-22T18:42:17.000Z",
        "RawFinding": json.dumps(
            finding, separators=(",", ":"), sort_keys=True
        ),
    }


@pytest.mark.parametrize(
    ("score", "expected"),
    [
        (0.0, "Informational"),
        (0.9, "Informational"),
        (1.0, "Low"),
        (3.9, "Low"),
        (4.0, "Medium"),
        (6.9, "Medium"),
        (7.0, "High"),
        (8.9, "High"),
        (9.0, "Critical"),
        (10.0, "Critical"),
    ],
)
def test_aws_severity_boundaries(handler_module, score, expected):
    assert handler_module.severity_level(score) == expected


@given(st.floats(min_value=9, max_value=10, allow_nan=False))
def test_all_documented_critical_scores_remain_critical(score):
    assert load_handler_module().severity_level(score) == "Critical"


@given(st.floats(min_value=7, max_value=8.999999, allow_nan=False))
def test_high_scores_are_not_promoted_to_critical(score):
    assert load_handler_module().severity_level(score) == "High"


def test_parse_rejects_unrecognized_event(handler_module):
    with pytest.raises(ValueError, match="Unrecognized event format"):
        handler_module.parse_guardduty_finding({"source": "aws.guardduty"})


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (lambda finding: finding.pop("arn"), "arn"),
        (lambda finding: finding.update(severity=10.1), "between 0 and 10"),
        (lambda finding: finding.update(severity="9.0"), "must be numeric"),
        (lambda finding: finding.update(resource=[]), "must be an object"),
    ],
)
def test_required_aws_contract_is_enforced(
    handler_module, finding, mutation, message
):
    mutation(finding)
    with pytest.raises(ValueError, match=message):
        handler_module.parse_guardduty_finding(finding)


def test_native_azure_adapter_has_no_raw_custom_columns(handler_module, finding):
    record = handler_module.to_azure_guardduty_record(finding)

    assert record["Id"] == finding["id"]
    assert record["ActivityType"] == finding["type"]
    assert record["ResourceDetails"] == finding["resource"]
    assert record["ServiceDetails"] == finding["service"]
    assert record["Severity"] == 8
    assert "EventData" not in record
    assert "Message" not in record
    assert "RawFinding" not in record


def test_module_import_does_not_require_lambda_environment(monkeypatch):
    monkeypatch.setattr("os.environ", {})
    module = load_handler_module()

    with pytest.raises(RuntimeError, match="SENTINEL_WORKSPACE_ID"):
        module.post_to_sentinel("[]", "AWSGuardDutyDirect")


def test_legacy_post_signs_utf8_byte_length(handler_module):
    response = context_response()
    shared_key = base64.b64encode(b"test-key").decode()
    body = '[{"Title":"München"}]'

    with mock.patch.object(
        handler_module.urllib.request, "urlopen", return_value=response
    ) as urlopen, mock.patch.object(
        handler_module, "build_signature", return_value="signature"
    ) as signature:
        status = handler_module.post_to_sentinel(
            body,
            "AWSGuardDutyDirect",
            workspace_id="workspace-123",
            shared_key=shared_key,
        )

    assert status == 200
    assert signature.call_args.args[3] == len(body.encode("utf-8"))
    request = urlopen.call_args.args[0]
    assert request.data == body.encode("utf-8")
    assert request.headers["Authorization"] == "signature"
    assert urlopen.call_args.kwargs["timeout"] == 15


def test_build_signature_rejects_invalid_base64(handler_module):
    with pytest.raises(ValueError):
        handler_module.build_signature("workspace", "not base64!", "date", 2)


def test_build_signature_matches_known_hmac(handler_module):
    signature = handler_module.build_signature(
        "workspace",
        base64.b64encode(b"key").decode(),
        "Thu, 23 Jul 2026 12:00:00 GMT",
        2,
    )
    assert signature == (
        "SharedKey workspace:"
        "0jlQeKA42XKin5ZMkaZbPvx8IiLED7pYmMz1h+DmMmw="
    )


def test_retry_delay_falls_back_for_non_numeric_header(handler_module):
    failure = http_error(
        handler_module, 429, headers={"Retry-After": "not-a-number"}
    )
    assert handler_module._retry_delay(failure, 2) == 4
    assert handler_module._retry_delay(ValueError("x"), 10) == 30


def test_network_error_is_retryable(handler_module):
    failure = urllib.error.URLError("reset")
    with mock.patch.object(
        handler_module.urllib.request,
        "urlopen",
        side_effect=[failure, context_response()],
    ), mock.patch.object(handler_module.time, "sleep"):
        assert handler_module._open_with_retry(mock.Mock(), max_attempts=2) == 200


def test_zero_retry_attempts_is_configuration_error(handler_module):
    with pytest.raises(ValueError, match="at least 1"):
        handler_module._open_with_retry(mock.Mock(), max_attempts=0)


@pytest.mark.parametrize("status", [408, 425, 429, 500, 502, 503, 504])
def test_transient_statuses_are_retried(handler_module, status):
    transient = http_error(
        handler_module, status, headers={"Retry-After": "0"}
    )
    response = context_response()
    with mock.patch.object(
        handler_module.urllib.request,
        "urlopen",
        side_effect=[transient, response],
    ) as urlopen, mock.patch.object(handler_module.time, "sleep") as sleep:
        result = handler_module._open_with_retry(
            mock.Mock(), max_attempts=2
        )

    assert result == 200
    assert urlopen.call_count == 2
    sleep.assert_called_once_with(0.0)


def test_client_error_is_not_retried(handler_module):
    failure = http_error(handler_module, 400)
    with mock.patch.object(
        handler_module.urllib.request, "urlopen", side_effect=failure
    ) as urlopen:
        with pytest.raises(urllib.error.HTTPError) as caught:
            handler_module._open_with_retry(mock.Mock(), max_attempts=3)

    assert caught.value.code == 400
    assert urlopen.call_count == 1


def test_persistent_server_error_exhausts_retry_budget(handler_module):
    failure = http_error(handler_module, 503)
    with mock.patch.object(
        handler_module.urllib.request,
        "urlopen",
        side_effect=[failure, failure, failure],
    ), mock.patch.object(handler_module.time, "sleep") as sleep:
        with pytest.raises(urllib.error.HTTPError):
            handler_module._open_with_retry(mock.Mock(), max_attempts=3)

    assert sleep.call_count == 2


def test_logs_ingestion_request_uses_dcr_contract(handler_module):
    with mock.patch.object(
        handler_module, "_open_with_retry", return_value=204
    ) as send:
        status = handler_module.post_to_logs_ingestion(
            '[{"Id":"finding"}]',
            endpoint="https://example.ingest.monitor.azure.com/",
            dcr_immutable_id="dcr-immutable",
            stream_name="Microsoft-AWSGuardDuty",
            access_token="token",
        )

    assert status == 204
    request = send.call_args.args[0]
    assert request.method == "POST"
    assert request.full_url == (
        "https://example.ingest.monitor.azure.com/dataCollectionRules/"
        "dcr-immutable/streams/Microsoft-AWSGuardDuty?api-version=2023-01-01"
    )
    assert request.headers["Authorization"] == "Bearer token"


def test_access_token_uses_client_credentials(handler_module, monkeypatch):
    monkeypatch.setenv("AZURE_TENANT_ID", "tenant")
    monkeypatch.setenv("AZURE_CLIENT_ID", "client")
    monkeypatch.setenv("AZURE_CLIENT_SECRET", "secret")
    response = context_response(
        body=json.dumps({"access_token": "token", "expires_in": 3600}).encode()
    )
    with mock.patch.object(
        handler_module.urllib.request, "urlopen", return_value=response
    ) as urlopen:
        assert handler_module._get_access_token() == "token"

    request = urlopen.call_args.args[0]
    assert request.full_url.endswith("/tenant/oauth2/v2.0/token")
    form = request.data.decode()
    assert "grant_type=client_credentials" in form
    assert "scope=https%3A%2F%2Fmonitor.azure.com%2F.default" in form


def test_access_token_is_cached(handler_module):
    handler_module._cached_access_token = ("cached", float("inf"))
    with mock.patch.object(handler_module.urllib.request, "urlopen") as urlopen:
        assert handler_module._get_access_token() == "cached"
    urlopen.assert_not_called()


def test_access_token_requires_token_in_response(handler_module, monkeypatch):
    monkeypatch.setenv("AZURE_TENANT_ID", "tenant")
    monkeypatch.setenv("AZURE_CLIENT_ID", "client")
    monkeypatch.setenv("AZURE_CLIENT_SECRET", "secret")
    response = context_response(body=b'{"expires_in":3600}')
    with mock.patch.object(
        handler_module.urllib.request, "urlopen", return_value=response
    ):
        with pytest.raises(RuntimeError, match="access_token"):
            handler_module._get_access_token()


@pytest.mark.parametrize(
    "event",
    [
        {
            "detail-type": "GuardDuty Finding",
            "source": "not.guardduty",
            "detail": {},
        },
        {
            "detail-type": "GuardDuty Finding",
            "source": "aws.guardduty",
            "detail": [],
        },
    ],
)
def test_eventbridge_envelope_is_strict(handler_module, event):
    with pytest.raises(ValueError):
        handler_module.unwrap_guardduty_finding(event)


def test_parser_tolerates_non_list_interfaces(handler_module, finding):
    finding["resource"]["instanceDetails"]["networkInterfaces"] = {}
    assert handler_module.parse_guardduty_finding(finding)["VpcId"] is None


def test_batching_obeys_count_limit(handler_module):
    records = [{"Id": f"f-{index}"} for index in range(30)]
    batches = list(
        handler_module.iter_batches(
            records, batch_size=25, max_batch_bytes=100_000
        )
    )
    assert [len(batch) for batch in batches] == [25, 5]


def test_batching_obeys_utf8_byte_limit(handler_module):
    records = [{"Title": "é" * 10}, {"Title": "é" * 10}]
    single_size = len(handler_module._encoded_json([records[0]]).encode("utf-8"))
    batches = list(
        handler_module.iter_batches(
            records, batch_size=25, max_batch_bytes=single_size + 1
        )
    )
    assert [len(batch) for batch in batches] == [1, 1]


def test_oversize_single_record_is_rejected(handler_module):
    with pytest.raises(ValueError, match="single record"):
        list(
            handler_module.iter_batches(
                [{"Title": "x" * 100}], max_batch_bytes=10
            )
        )


def test_invalid_batch_limits_are_rejected(handler_module):
    with pytest.raises(ValueError, match="positive"):
        list(handler_module.iter_batches([], batch_size=0))


def test_post_batch_never_swallows_partial_delivery(
    handler_module, monkeypatch
):
    monkeypatch.setattr(handler_module, "BATCH_SIZE", 1)
    with mock.patch.object(
        handler_module,
        "post_to_logs_ingestion",
        side_effect=[204, http_error(handler_module, 503)],
    ):
        with pytest.raises(urllib.error.HTTPError):
            handler_module.post_batch_to_sentinel(
                [{"Id": "one"}, {"Id": "two"}],
                mode="dcr",
            )


def test_legacy_batch_uses_compatibility_transport(handler_module, finding):
    record = handler_module.parse_guardduty_finding(finding)
    with mock.patch.object(
        handler_module, "post_to_sentinel", return_value=200
    ) as post:
        result = handler_module.post_batch_to_sentinel(
            [record],
            "AWSGuardDutyDirect",
            workspace_id="workspace",
            shared_key="key",
            mode="legacy",
        )
    assert result == {"batches_sent": 1, "records_sent": 1}
    assert post.call_args.kwargs == {
        "workspace_id": "workspace",
        "shared_key": "key",
    }


def test_unknown_transport_is_rejected(handler_module):
    with pytest.raises(ValueError, match="Unsupported"):
        handler_module.post_batch_to_sentinel([{"Id": "one"}], mode="unknown")


def test_unexpected_success_status_is_rejected(handler_module):
    with mock.patch.object(
        handler_module, "post_to_logs_ingestion", return_value=300
    ):
        with pytest.raises(RuntimeError, match="unexpected status"):
            handler_module.post_batch_to_sentinel([{"Id": "one"}], mode="dcr")


def test_handler_posts_native_records(handler_module, finding):
    with mock.patch.object(
        handler_module,
        "post_batch_to_sentinel",
        return_value={"batches_sent": 1, "records_sent": 1},
    ) as post:
        result = handler_module.handler(finding, None)

    assert result["statusCode"] == 200
    posted = post.call_args.args[0][0]
    assert posted["Id"] == finding["id"]
    assert posted["ActivityType"] == finding["type"]


def test_handler_accepts_batch(handler_module, finding):
    second = copy.deepcopy(finding)
    second["id"] = "11111111111111111111111111111111"
    with mock.patch.object(
        handler_module,
        "post_batch_to_sentinel",
        return_value={"batches_sent": 1, "records_sent": 2},
    ) as post:
        result = handler_module.handler({"findings": [finding, second]}, None)

    assert json.loads(result["body"])["records_sent"] == 2
    assert len(post.call_args.args[0]) == 2


def test_handler_raises_for_empty_batch(handler_module):
    with pytest.raises(ValueError, match="non-empty"):
        handler_module.handler({"findings": []}, None)


def test_handler_rejects_non_object_event(handler_module):
    with pytest.raises(ValueError, match="must be an object"):
        handler_module.handler([], None)


def test_handler_rejects_non_object_batch_member(handler_module):
    with pytest.raises(ValueError, match="every finding"):
        handler_module.handler({"findings": ["invalid"]}, None)


def test_handler_legacy_mode_posts_flat_record(handler_module, finding, monkeypatch):
    monkeypatch.setattr(handler_module, "INGESTION_MODE", "legacy")
    with mock.patch.object(
        handler_module,
        "post_batch_to_sentinel",
        return_value={"batches_sent": 1, "records_sent": 1},
    ) as post:
        handler_module.handler(finding, None)
    assert post.call_args.args[0][0]["FindingId"] == finding["id"]


def test_handler_rejects_unknown_mode(handler_module, finding, monkeypatch):
    monkeypatch.setattr(handler_module, "INGESTION_MODE", "unknown")
    with pytest.raises(ValueError, match="Unsupported"):
        handler_module.handler(finding, None)


def test_handler_raises_delivery_failure_for_lambda_retry(
    handler_module, finding
):
    with mock.patch.object(
        handler_module,
        "post_batch_to_sentinel",
        side_effect=urllib.error.URLError("unreachable"),
    ):
        with pytest.raises(urllib.error.URLError):
            handler_module.handler(finding, None)
