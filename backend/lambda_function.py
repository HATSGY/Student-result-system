"""
Student Result Management System - AWS Lambda backend (Python 3.12)

One function handles every API Gateway (HTTP API, payload format 2.0) route:

    GET    /students                 list, or search with ?search=
    GET    /students/{rollNumber}    one student
    POST   /students                 create
    PUT    /students/{rollNumber}    update
    DELETE /students/{rollNumber}    delete
    GET    /stats                    dashboard statistics

Environment variables:
    ADMIN_PASSCODE  (required) passcode the frontend sends in x-admin-passcode
    TABLE_NAME      (optional) DynamoDB table, defaults to StudentResults

CORS is configured on API Gateway, so this function adds no CORS headers.
"""
import base64
import hmac
import json
import logging
import os
import re
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

TABLE_NAME = os.environ.get("TABLE_NAME", "StudentResults")
table = boto3.resource("dynamodb").Table(TABLE_NAME)

SUBJECT_KEYS = ["subject1", "subject2", "subject3", "subject4", "subject5"]
MAX_TOTAL = 500
PASS_MARK = 40
ROLL_RE = re.compile(r"^[A-Za-z0-9_-]{1,20}$")
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


class ApiError(Exception):
    def __init__(self, status, code, message, details=None):
        super().__init__(message)
        self.status, self.code, self.message, self.details = status, code, message, details


# ---------- responses ----------
def _json_default(o):
    if isinstance(o, Decimal):
        return int(o) if o == o.to_integral_value() else float(o)
    raise TypeError(f"Cannot serialise {type(o)}")


def respond(status, payload=None):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": "" if payload is None else json.dumps(payload, default=_json_default),
    }


def ok(data, message="OK", status=200):
    return respond(status, {"success": True, "data": data, "message": message})


def fail(err):
    error = {"code": err.code, "message": err.message}
    if err.details:
        error["details"] = err.details
    return respond(err.status, {"success": False, "error": error})


# ---------- request helpers ----------
def check_auth(event):
    expected = os.environ.get("ADMIN_PASSCODE", "")
    if not expected:
        raise ApiError(500, "CONFIG_ERROR", "Server is not configured: ADMIN_PASSCODE is missing.")
    given = (event.get("headers") or {}).get("x-admin-passcode", "")
    if not hmac.compare_digest(given.encode("utf-8"), expected.encode("utf-8")):
        raise ApiError(401, "UNAUTHORIZED", "Incorrect or missing passcode.")


def parse_body(event):
    raw = event.get("body")
    if not raw:
        raise ApiError(400, "INVALID_REQUEST", "Request body is required.")
    try:
        if event.get("isBase64Encoded"):
            raw = base64.b64decode(raw).decode("utf-8")
        data = json.loads(raw)
    except ValueError:
        raise ApiError(400, "INVALID_REQUEST", "Request body must be valid JSON.")
    if not isinstance(data, dict):
        raise ApiError(400, "INVALID_REQUEST", "Request body must be a JSON object.")
    return data


def roll_from_path(event):
    roll = (event.get("pathParameters") or {}).get("rollNumber", "")
    if not ROLL_RE.match(roll):
        raise ApiError(404, "NOT_FOUND", "Student not found.")
    return roll


# ---------- validation & calculation ----------
def to_int(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, str) and re.fullmatch(r"-?\d+", v.strip()):
        return int(v.strip())
    return None


def validate_student(body, roll_number=None):
    """Return a clean dict or raise ApiError(400) listing every problem by field."""
    errors, clean = {}, {}

    def text(key):
        v = body.get(key)
        return v.strip() if isinstance(v, str) else ""

    roll = roll_number
    if roll is None:
        v = body.get("rollNumber")
        roll = str(v) if isinstance(v, int) and not isinstance(v, bool) else text("rollNumber")
    if not ROLL_RE.match(roll):
        errors["rollNumber"] = "Use 1-20 letters, digits, - or _."
    clean["rollNumber"] = roll

    name = text("studentName")
    if not 2 <= len(name) <= 60:
        errors["studentName"] = "Enter a name of 2-60 characters."
    clean["studentName"] = name

    email = text("email")
    if not EMAIL_RE.match(email) or len(email) > 100:
        errors["email"] = "Enter a valid email address."
    clean["email"] = email

    course = text("course")
    if not 1 <= len(course) <= 80:
        errors["course"] = "Enter a course (max 80 characters)."
    clean["course"] = course

    sem = to_int(body.get("semester"))
    if sem is None or not 1 <= sem <= 8:
        errors["semester"] = "Semester must be a whole number from 1 to 8."
    clean["semester"] = sem

    for key in SUBJECT_KEYS:
        m = to_int(body.get(key))
        if m is None or not 0 <= m <= 100:
            errors[key] = "Marks must be a whole number from 0 to 100."
        clean[key] = m

    if errors:
        raise ApiError(400, "VALIDATION_ERROR", "Please fix the highlighted fields.", errors)
    return clean


def calculate(clean):
    """The backend is authoritative for total, percentage and result."""
    marks = [clean[k] for k in SUBJECT_KEYS]
    total = sum(marks)
    percentage = (Decimal(total) * 100 / MAX_TOTAL).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    passed = all(m >= PASS_MARK for m in marks) and percentage >= PASS_MARK
    return {"totalMarks": total, "percentage": percentage, "result": "PASS" if passed else "FAIL"}


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def scan_all():
    items, kwargs = [], {}
    while True:
        page = table.scan(**kwargs)
        items.extend(page.get("Items", []))
        if "LastEvaluatedKey" not in page:
            return items
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def newest_first(items):
    return sorted(items, key=lambda s: s.get("createdAt", ""), reverse=True)


# ---------- route handlers ----------
def list_students(event):
    term = ((event.get("queryStringParameters") or {}).get("search") or "").strip().lower()
    items = scan_all()
    if term:
        items = [s for s in items if term in s.get("studentName", "").lower() or term in s.get("rollNumber", "").lower()]
    return ok(newest_first(items))


def get_student(event):
    roll = roll_from_path(event)
    item = table.get_item(Key={"rollNumber": roll}).get("Item")
    if not item:
        raise ApiError(404, "NOT_FOUND", f"No student with roll number {roll}.")
    return ok(item)


def create_student(event):
    clean = validate_student(parse_body(event))
    stamp = now_iso()
    item = {**clean, **calculate(clean), "createdAt": stamp, "updatedAt": stamp}
    try:
        table.put_item(Item=item, ConditionExpression="attribute_not_exists(rollNumber)")
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            msg = f"Roll number {clean['rollNumber']} already exists."
            raise ApiError(409, "DUPLICATE_ROLL_NUMBER", msg, {"rollNumber": msg})
        raise
    return ok(item, "Student added successfully", 201)


def update_student(event):
    roll = roll_from_path(event)
    clean = validate_student(parse_body(event), roll_number=roll)  # path roll number wins
    fields = {**clean, **calculate(clean), "updatedAt": now_iso()}
    fields.pop("rollNumber")
    try:
        res = table.update_item(
            Key={"rollNumber": roll},
            UpdateExpression="SET " + ", ".join(f"#{k} = :{k}" for k in fields),
            ExpressionAttributeNames={**{f"#{k}": k for k in fields}, "#rn": "rollNumber"},
            ExpressionAttributeValues={f":{k}": v for k, v in fields.items()},
            ConditionExpression="attribute_exists(#rn)",
            ReturnValues="ALL_NEW",
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise ApiError(404, "NOT_FOUND", f"No student with roll number {roll}.")
        raise
    return ok(res["Attributes"], "Student updated successfully")


def delete_student(event):
    roll = roll_from_path(event)
    try:
        table.delete_item(Key={"rollNumber": roll}, ConditionExpression="attribute_exists(rollNumber)")
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise ApiError(404, "NOT_FOUND", f"No student with roll number {roll}.")
        raise
    return ok({"rollNumber": roll}, "Student deleted successfully")


def get_stats(event):
    items = scan_all()
    total = len(items)
    passed = sum(1 for s in items if s.get("result") == "PASS")
    average = Decimal(0)
    if total:
        average = (sum(Decimal(s["percentage"]) for s in items) / total).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    dist = {"90-100": 0, "75-89": 0, "60-74": 0, "40-59": 0, "0-39": 0}
    for s in items:
        p = Decimal(s["percentage"])
        key = "90-100" if p >= 90 else "75-89" if p >= 75 else "60-74" if p >= 60 else "40-59" if p >= 40 else "0-39"
        dist[key] += 1
    return ok({
        "total": total,
        "passed": passed,
        "failed": total - passed,
        "averagePercentage": average,
        "distribution": dist,
        "recent": newest_first(items)[:5],
    })


ROUTES = {
    "GET /students": list_students,
    "GET /students/{rollNumber}": get_student,
    "POST /students": create_student,
    "PUT /students/{rollNumber}": update_student,
    "DELETE /students/{rollNumber}": delete_student,
    "GET /stats": get_stats,
}


# ---------- entry point ----------
def lambda_handler(event, context):
    try:
        route = event.get("routeKey", "")
        if route.startswith("OPTIONS"):  # API Gateway normally answers preflight itself
            return respond(204)
        check_auth(event)
        handler = ROUTES.get(route)
        if handler is None:
            raise ApiError(404, "ROUTE_NOT_FOUND", f"No route for {route}.")
        return handler(event)
    except ApiError as e:
        return fail(e)
    except ClientError:
        logger.exception("DynamoDB error")
        return fail(ApiError(500, "DATABASE_ERROR", "The database request failed. Please try again."))
    except Exception:
        logger.exception("Unhandled error")
        return fail(ApiError(500, "INTERNAL_ERROR", "Something went wrong on the server."))
