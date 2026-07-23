from __future__ import annotations

import gzip
import json
import os
import time
import urllib.parse
import uuid

import pytest


pytestmark = [
    pytest.mark.container,
    pytest.mark.skipif(
        os.environ.get("RUN_CONTAINER_TESTS") != "1",
        reason="set RUN_CONTAINER_TESTS=1 to run Docker integration tests",
    ),
]


def test_guardduty_jsonl_gzip_flows_from_s3_notification_to_sqs(finding):
    """Exercise the package and notification contract used by Sentinel's connector."""
    boto3 = pytest.importorskip("boto3")
    localstack_module = pytest.importorskip("testcontainers.localstack")
    LocalStackContainer = localstack_module.LocalStackContainer

    with LocalStackContainer(
        image="localstack/localstack:4.7.0"
    ).with_services("s3", "sqs") as localstack:
        endpoint = localstack.get_url()
        credentials = {
            "aws_access_key_id": "test",
            "aws_secret_access_key": "test",
            "region_name": "us-east-1",
            "endpoint_url": endpoint,
        }
        s3 = boto3.client("s3", **credentials)
        sqs = boto3.client("sqs", **credentials)

        suffix = uuid.uuid4().hex
        bucket = f"guardduty-contract-{suffix}"
        queue_url = sqs.create_queue(QueueName=f"guardduty-{suffix}")[
            "QueueUrl"
        ]
        queue_arn = sqs.get_queue_attributes(
            QueueUrl=queue_url, AttributeNames=["QueueArn"]
        )["Attributes"]["QueueArn"]
        sqs.set_queue_attributes(
            QueueUrl=queue_url,
            Attributes={
                "Policy": json.dumps(
                    {
                        "Version": "2012-10-17",
                        "Statement": [
                            {
                                "Effect": "Allow",
                                "Principal": {"Service": "s3.amazonaws.com"},
                                "Action": "sqs:SendMessage",
                                "Resource": queue_arn,
                                "Condition": {
                                    "ArnEquals": {
                                        "aws:SourceArn": f"arn:aws:s3:::{bucket}"
                                    }
                                },
                            }
                        ],
                    }
                )
            },
        )
        s3.create_bucket(Bucket=bucket)
        s3.put_bucket_notification_configuration(
            Bucket=bucket,
            NotificationConfiguration={
                "QueueConfigurations": [
                    {
                        "QueueArn": queue_arn,
                        "Events": ["s3:ObjectCreated:*"],
                        "Filter": {
                            "Key": {
                                "FilterRules": [
                                    {"Name": "suffix", "Value": ".jsonl.gz"}
                                ]
                            }
                        },
                    }
                ]
            },
        )

        key = "AWSLogs/123456789012/GuardDuty/us-west-2/findings.jsonl.gz"
        payload = gzip.compress(
            (json.dumps(finding, separators=(",", ":")) + "\n").encode()
        )
        s3.put_object(
            Bucket=bucket,
            Key=key,
            Body=payload,
            ContentEncoding="gzip",
            ContentType="application/x-ndjson",
        )

        notifications = []
        matching_notification = False
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline and not matching_notification:
            messages = sqs.receive_message(
                QueueUrl=queue_url,
                WaitTimeSeconds=2,
                MaxNumberOfMessages=10,
            ).get("Messages", [])

            for message in messages:
                notification = json.loads(message["Body"])
                if "Records" in notification:
                    notifications.append(notification)
                    matching_notification = any(
                        urllib.parse.unquote_plus(
                            record["s3"]["object"]["key"]
                        )
                        == key
                        for record in notification["Records"]
                    )
                sqs.delete_message(
                    QueueUrl=queue_url,
                    ReceiptHandle=message["ReceiptHandle"],
                )

        assert matching_notification, (
            "S3 did not emit the expected object-created notification; "
            f"received {notifications!r}"
        )

        stored = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
        lines = gzip.decompress(stored).decode().splitlines()
        assert len(lines) == 1
        assert json.loads(lines[0])["id"] == finding["id"]
