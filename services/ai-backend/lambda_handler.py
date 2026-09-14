import json
import os

from mangum import Mangum


def _read_json_secret(secret_id: str, json_key: str) -> str:
    # boto3 is included by the AWS Lambda Python base image. Import it lazily so
    # the regular local FastAPI image does not need an AWS SDK dependency.
    import boto3

    response = boto3.client("secretsmanager").get_secret_value(SecretId=secret_id)
    secret_string = response.get("SecretString")
    if not isinstance(secret_string, str):
        raise RuntimeError("the configured Secrets Manager value is not a JSON string")
    try:
        payload: object = json.loads(secret_string)
    except json.JSONDecodeError as error:
        raise RuntimeError("the configured Secrets Manager value is not valid JSON") from error
    if not isinstance(payload, dict):
        raise RuntimeError("the configured Secrets Manager value is not a JSON object")
    value = payload.get(json_key)
    if not isinstance(value, str) or not value:
        raise RuntimeError(f"the configured Secrets Manager value is missing {json_key}")
    return value


def _configure_lambda_secrets() -> None:
    if not os.getenv("AWS_LAMBDA_FUNCTION_NAME"):
        return
    for secret_arn_variable, value_variable, json_key in (
        ("EXA_API_KEY_SECRET_ARN", "EXA_API_KEY", "EXA_API_KEY"),
        (
            "INTERNAL_SERVICE_TOKEN_SECRET_ARN",
            "INTERNAL_SERVICE_TOKEN",
            "INTERNAL_SERVICE_TOKEN",
        ),
    ):
        secret_id = os.getenv(secret_arn_variable)
        if not secret_id:
            raise RuntimeError(f"{secret_arn_variable} is required in Lambda")
        os.environ[value_variable] = _read_json_secret(secret_id, json_key)


_configure_lambda_secrets()

from app.main import app  # noqa: E402  # configure Lambda secrets before Settings.from_env()

handler = Mangum(app, lifespan="off")
