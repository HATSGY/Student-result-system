import json
import os

import boto3
import pytest
from moto import mock_aws

os.environ.setdefault("AWS_DEFAULT_REGION", "ap-southeast-2")
os.environ.setdefault("AWS_ACCESS_KEY_ID", "test")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "test")
os.environ["ADMIN_PASSCODE"] = "secret"
os.environ["TABLE_NAME"] = "StudentResults"

STUDENT = {
    "rollNumber": "R001", "studentName": "Asha Rao", "email": "asha@example.com",
    "course": "B.Tech CSE", "semester": 3,
    "subject1": 80, "subject2": 70, "subject3": 60, "subject4": 90, "subject5": 50,
}


@pytest.fixture()
def lam():
    with mock_aws():
        boto3.client("dynamodb").create_table(
            TableName="StudentResults",
            KeySchema=[{"AttributeName": "rollNumber", "KeyType": "HASH"}],
            AttributeDefinitions=[{"AttributeName": "rollNumber", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        import importlib
        import lambda_function
        importlib.reload(lambda_function)  # rebind the table inside the mock
        yield lambda_function


def call(lam, route, body=None, roll=None, passcode="secret", query=None):
    event = {
        "routeKey": route,
        "headers": {"x-admin-passcode": passcode},
        "pathParameters": {"rollNumber": roll} if roll else None,
        "queryStringParameters": query,
        "body": json.dumps(body) if body is not None else None,
    }
    res = lam.lambda_handler(event, None)
    return res["statusCode"], json.loads(res["body"]) if res["body"] else None


def test_calculate_pass_and_fail(lam):
    assert lam.calculate({k: 80 for k in lam.SUBJECT_KEYS})["result"] == "PASS"
    low = {k: 80 for k in lam.SUBJECT_KEYS}
    low["subject1"] = 39
    assert lam.calculate(low)["result"] == "FAIL"


def test_requires_passcode(lam):
    status, _ = call(lam, "GET /students", passcode="wrong")
    assert status == 401


def test_create_get_update_delete_flow(lam):
    status, body = call(lam, "POST /students", STUDENT)
    assert status == 201 and body["data"]["totalMarks"] == 350

    status, _ = call(lam, "POST /students", STUDENT)
    assert status == 409  # duplicate roll number

    status, body = call(lam, "GET /students/{rollNumber}", roll="R001")
    assert status == 200 and body["data"]["studentName"] == "Asha Rao"

    status, body = call(lam, "PUT /students/{rollNumber}", {**STUDENT, "subject5": 100}, roll="R001")
    assert status == 200 and body["data"]["totalMarks"] == 400

    status, body = call(lam, "GET /stats")
    assert body["data"]["total"] == 1

    status, _ = call(lam, "DELETE /students/{rollNumber}", roll="R001")
    assert status == 200
    status, _ = call(lam, "GET /students/{rollNumber}", roll="R001")
    assert status == 404


def test_validation_errors(lam):
    status, body = call(lam, "POST /students", {**STUDENT, "subject1": 150, "email": "bad"})
    assert status == 400
    assert set(body["error"]["details"]) == {"subject1", "email"}
