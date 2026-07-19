import base64
import importlib.util
import json
import pathlib
import unittest
from unittest import mock


MODULE_PATH = (
    pathlib.Path(__file__).resolve().parents[1]
    / "scripts"
    / "lambda_ingestion_handler.py"
)


def load_handler_module():
    spec = importlib.util.spec_from_file_location("lambda_ingestion_handler", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class LambdaIngestionHandlerTests(unittest.TestCase):
    def setUp(self):
        self.handler = load_handler_module()

    def sample_finding(self):
        return {
            "schemaVersion": "2.0",
            "id": "finding-123",
            "type": "UnauthorizedAccess:IAMUser/InstanceCredentialExfiltration",
            "severity": 8.7,
            "title": "Credentials used from external IP",
            "description": "An IAM access key was used suspiciously.",
            "accountId": "123456789012",
            "region": "eu-west-2",
            "createdAt": "2025-01-15T10:00:00Z",
            "updatedAt": "2025-01-15T10:05:00Z",
            "resource": {
                "resourceType": "AccessKey",
                "accessKeyDetails": {
                    "accessKeyId": "AKIAEXAMPLE",
                    "userName": "analyst",
                    "userType": "IAMUser",
                },
            },
            "service": {
                "detectorId": "detector-123",
                "eventFirstSeen": "2025-01-15T10:00:00Z",
                "eventLastSeen": "2025-01-15T10:05:00Z",
                "action": {
                    "actionType": "AWS_API_CALL",
                    "awsApiCallAction": {
                        "api": "GetCallerIdentity",
                        "callerType": "Remote IP",
                        "remoteIpDetails": {
                            "ipAddressV4": "203.0.113.10",
                            "country": {"countryName": "United Kingdom"},
                        },
                    },
                },
            },
        }

    # ── Parsing tests ─────────────────────────────────────────────────────────

    def test_parse_eventbridge_finding(self):
        event = {"detail-type": "GuardDuty Finding", "detail": self.sample_finding()}

        parsed = self.handler.parse_guardduty_finding(event)

        self.assertEqual(parsed["FindingId"], "finding-123")
        self.assertEqual(parsed["SeverityLevel"], "Critical")
        self.assertEqual(parsed["RemoteIp"], "203.0.113.10")
        self.assertEqual(parsed["ApiName"], "GetCallerIdentity")
        self.assertEqual(parsed["AccessKeyId"], "AKIAEXAMPLE")
        self.assertEqual(json.loads(parsed["RawFinding"])["id"], "finding-123")

    def test_parse_direct_finding(self):
        parsed = self.handler.parse_guardduty_finding(self.sample_finding())

        self.assertEqual(parsed["AwsAccountId"], "123456789012")
        self.assertEqual(parsed["AwsRegion"], "eu-west-2")

    def test_parse_rejects_unrecognized_event(self):
        with self.assertRaises(ValueError):
            self.handler.parse_guardduty_finding({"source": "aws.guardduty"})

    def test_module_import_does_not_require_lambda_environment(self):
        with mock.patch.dict("os.environ", {}, clear=True):
            module = load_handler_module()

        with self.assertRaisesRegex(RuntimeError, "SENTINEL_WORKSPACE_ID"):
            module.post_to_sentinel("[]", "AWSGuardDuty")

    # ── post_to_sentinel: happy path ──────────────────────────────────────────

    def test_post_to_sentinel_builds_expected_request(self):
        response = mock.Mock()
        response.getcode.return_value = 200
        response.__enter__ = mock.Mock(return_value=response)
        response.__exit__ = mock.Mock(return_value=None)

        shared_key = base64.b64encode(b"test-key").decode("utf-8")
        with mock.patch.object(
            self.handler.urllib.request, "urlopen", return_value=response
        ) as urlopen:
            status = self.handler.post_to_sentinel(
                '[{"FindingId":"finding-123"}]',
                "AWSGuardDuty",
                workspace_id="workspace-123",
                shared_key=shared_key,
            )

        self.assertEqual(status, 200)
        request = urlopen.call_args.args[0]
        self.assertIn("workspace-123.ods.opinsights.azure.com", request.full_url)
        self.assertEqual(request.headers["Log-type"], "AWSGuardDuty")
        self.assertIn("SharedKey workspace-123:", request.headers["Authorization"])

    # ── post_to_sentinel: retry logic ────────────────────────────────────────

    def test_post_to_sentinel_retries_on_5xx(self):
        """A 503 should be retried; success on the second attempt returns 200."""
        shared_key = base64.b64encode(b"test-key").decode("utf-8")

        server_error = self.handler.urllib.error.HTTPError(
            url="https://example.com", code=503, msg="Service Unavailable",
            hdrs=None, fp=None,
        )
        good_response = mock.Mock()
        good_response.getcode.return_value = 200
        good_response.__enter__ = mock.Mock(return_value=good_response)
        good_response.__exit__ = mock.Mock(return_value=None)

        with mock.patch.object(
            self.handler.urllib.request, "urlopen",
            side_effect=[server_error, good_response],
        ):
            with mock.patch("time.sleep"):   # don't actually sleep in tests
                status = self.handler.post_to_sentinel(
                    "[]", "AWSGuardDuty",
                    workspace_id="ws-id", shared_key=shared_key,
                )

        self.assertEqual(status, 200)

    def test_post_to_sentinel_does_not_retry_4xx(self):
        """A 400 should raise immediately without retrying."""
        shared_key = base64.b64encode(b"test-key").decode("utf-8")

        client_error = self.handler.urllib.error.HTTPError(
            url="https://example.com", code=400, msg="Bad Request",
            hdrs=None, fp=None,
        )

        with mock.patch.object(
            self.handler.urllib.request, "urlopen",
            side_effect=[client_error],
        ) as urlopen:
            with self.assertRaises(self.handler.urllib.error.HTTPError) as ctx:
                self.handler.post_to_sentinel(
                    "[]", "AWSGuardDuty",
                    workspace_id="ws-id", shared_key=shared_key,
                )

        self.assertEqual(ctx.exception.code, 400)
        self.assertEqual(urlopen.call_count, 1)   # no retry

    def test_post_to_sentinel_exhausts_retries_on_persistent_5xx(self):
        """If all retries fail with 5xx, the last exception is re-raised."""
        shared_key = base64.b64encode(b"test-key").decode("utf-8")

        server_error = self.handler.urllib.error.HTTPError(
            url="https://example.com", code=500, msg="Internal Server Error",
            hdrs=None, fp=None,
        )

        with mock.patch.object(
            self.handler.urllib.request, "urlopen",
            side_effect=[server_error, server_error, server_error],
        ):
            with mock.patch("time.sleep"):
                with self.assertRaises(self.handler.urllib.error.HTTPError):
                    self.handler.post_to_sentinel(
                        "[]", "AWSGuardDuty",
                        workspace_id="ws-id", shared_key=shared_key,
                    )

    # ── Batch ingestion ───────────────────────────────────────────────────────

    def test_post_batch_splits_into_chunks(self):
        """post_batch_to_sentinel should split 30 records into 2 batches of 25/5."""
        shared_key = base64.b64encode(b"test-key").decode("utf-8")
        records = [{"FindingId": f"f-{i}"} for i in range(30)]

        good_response = mock.Mock()
        good_response.getcode.return_value = 200
        good_response.__enter__ = mock.Mock(return_value=good_response)
        good_response.__exit__ = mock.Mock(return_value=None)

        with mock.patch.object(
            self.handler.urllib.request, "urlopen", return_value=good_response
        ) as urlopen:
            with mock.patch.dict("os.environ", {"BATCH_SIZE": "25"}):
                # Reload to pick up BATCH_SIZE=25
                m = load_handler_module()
                result = m.post_batch_to_sentinel(
                    records, "AWSGuardDuty",
                    workspace_id="ws-id", shared_key=shared_key,
                )

        self.assertEqual(result["batches_sent"], 2)
        self.assertEqual(result["records_sent"], 30)
        self.assertEqual(result["failed_batches"], [])
        self.assertEqual(urlopen.call_count, 2)

    def test_handler_batch_mode(self):
        """handler() accepts {"findings": [...]} for batch ingestion."""
        findings = [self.sample_finding(), self.sample_finding()]
        # Give them distinct IDs
        findings[1]["id"] = "finding-456"

        good_response = mock.Mock()
        good_response.getcode.return_value = 200
        good_response.__enter__ = mock.Mock(return_value=good_response)
        good_response.__exit__ = mock.Mock(return_value=None)

        shared_key = base64.b64encode(b"test-key").decode("utf-8")
        env = {
            "SENTINEL_WORKSPACE_ID": "ws-id",
            "SENTINEL_SHARED_KEY": shared_key,
            "BATCH_SIZE": "25",
            "MAX_RETRIES": "1",
        }
        with mock.patch.dict("os.environ", env):
            m = load_handler_module()
            with mock.patch.object(
                m.urllib.request, "urlopen", return_value=good_response
            ):
                result = m.handler({"findings": findings}, None)

        self.assertEqual(result["statusCode"], 200)
        body = json.loads(result["body"])
        self.assertEqual(body["records_sent"], 2)

    def test_handler_batch_mode_rejects_empty_findings(self):
        result = self.handler.handler({"findings": []}, None)
        self.assertEqual(result["statusCode"], 400)


if __name__ == "__main__":
    unittest.main()
