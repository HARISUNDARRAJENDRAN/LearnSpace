"""Update only the worker database credential; keep runtime values out of logs."""

import json
import os
import subprocess
import tempfile


def main():
    arn = os.environ["WORKER_RUNTIME_SECRET_ARN"]
    current = subprocess.run(
        ["aws", "secretsmanager", "get-secret-value", "--secret-id", arn,
         "--query", "SecretString", "--output", "text"],
        check=True, capture_output=True, text=True,
    )
    runtime = json.loads(current.stdout)
    runtime["DATABASE_WORKER_URL"] = os.environ["DATABASE_WORKER_URL"]
    required = (
        "DATABASE_WORKER_URL", "DATABASE_AI_URL", "OPENAI_API_KEY",
        "KV_REST_API_URL", "KV_REST_API_TOKEN",
    )
    if any(not runtime.get(key) for key in required):
        raise RuntimeError("Worker runtime is missing a required credential")
    with tempfile.NamedTemporaryFile(mode="w") as secret:
        json.dump(runtime, secret)
        secret.flush()
        subprocess.run(
            ["aws", "secretsmanager", "put-secret-value", "--secret-id", arn,
             "--secret-string", f"file://{secret.name}"],
            check=True, capture_output=True, text=True,
        )
    print("Worker runtime configured; credentials remain in Secrets Manager.")


if __name__ == "__main__":
    main()
