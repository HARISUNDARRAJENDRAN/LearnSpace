"""Adopt an unmanaged Lambda without replacing it or copying its secret values."""

import json
import os
import subprocess
import tempfile
from pathlib import Path


def aws(*args: str) -> dict:
    result = subprocess.run(
        ["aws", *args, "--region", REGION, "--output", "json"],
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout) if result.stdout.strip() else {}


REGION = os.environ.get("AWS_REGION", "us-east-1")
STAGE = os.environ.get("LEARNSPACE_STAGE", "staging")
STACK = os.environ.get("AWS_STACK_NAME", f"learnspace-discovery-agent-{STAGE}")
FUNCTION = os.environ.get("AWS_FUNCTION_NAME", f"learnspace-discovery-agent-{STAGE}")


def main() -> None:
    try:
        aws("cloudformation", "describe-stacks", "--stack-name", STACK)
        print("Deployment stack already exists; no import needed.")
        return
    except subprocess.CalledProcessError as error:
        if "does not exist" not in error.stderr:
            raise

    try:
        function = aws("lambda", "get-function", "--function-name", FUNCTION)
    except subprocess.CalledProcessError as error:
        if "ResourceNotFoundException" not in error.stderr:
            raise
        print("No existing function; deployment will create it.")
        return

    config = function["Configuration"]
    if config["PackageType"] != "Image":
        raise RuntimeError("Only the existing LearnSpace container function can be adopted.")
    properties = {
        "FunctionName": FUNCTION,
        "PackageType": "Image",
        "Code": {"ImageUri": function["Code"]["ResolvedImageUri"]},
        "Role": config["Role"],
        "Architectures": config["Architectures"],
        "MemorySize": config["MemorySize"],
        "Timeout": config["Timeout"],
        "EphemeralStorage": config["EphemeralStorage"],
    }
    # Import never updates properties. Omit the old plaintext environment so
    # its credentials do not enter CloudFormation; deploy immediately replaces
    # it with the Secrets Manager ARN environment in template.yaml.
    template = {
        "AWSTemplateFormatVersion": "2010-09-09",
        "Resources": {
            "DiscoveryAgent": {
                "Type": "AWS::Lambda::Function",
                "DeletionPolicy": "Retain",
                "UpdateReplacePolicy": "Retain",
                "Properties": properties,
            }
        },
    }
    imports = [
        {
            "ResourceType": "AWS::Lambda::Function",
            "LogicalResourceId": "DiscoveryAgent",
            "ResourceIdentifier": {"FunctionName": FUNCTION},
        }
    ]
    with tempfile.TemporaryDirectory(prefix="learnspace-lambda-import-") as directory:
        template_path = Path(directory) / "template.json"
        import_path = Path(directory) / "imports.json"
        template_path.write_text(json.dumps(template))
        import_path.write_text(json.dumps(imports))
        change_set = aws(
            "cloudformation",
            "create-change-set",
            "--stack-name",
            STACK,
            "--change-set-name",
            "adopt-existing-discovery-agent",
            "--change-set-type",
            "IMPORT",
            "--template-body",
            f"file://{template_path}",
            "--resources-to-import",
            f"file://{import_path}",
        )["Id"]
        aws(
            "cloudformation",
            "wait",
            "change-set-create-complete",
            "--stack-name",
            STACK,
            "--change-set-name",
            change_set,
        )
        changes = aws("cloudformation", "describe-change-set", "--change-set-name", change_set)
        if any(change["ResourceChange"]["Action"] != "Import" for change in changes["Changes"]):
            raise RuntimeError("Import would change an existing resource; refusing to execute.")
        aws("cloudformation", "execute-change-set", "--change-set-name", change_set)
        aws("cloudformation", "wait", "stack-import-complete", "--stack-name", STACK)
    print(f"Adopted {FUNCTION} into {STACK}; deploy the Secrets Manager configuration next.")


if __name__ == "__main__":
    main()
