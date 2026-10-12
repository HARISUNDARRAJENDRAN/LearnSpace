import importlib.util
import json
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).parent
spec = importlib.util.spec_from_file_location("adoption", ROOT / "adopt-existing-function.py")
assert spec and spec.loader
adoption = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adoption)


def missing(operation: str, message: str) -> subprocess.CalledProcessError:
    return subprocess.CalledProcessError(254, ["aws", operation], stderr=message)


class DeploymentTests(unittest.TestCase):
    def test_existing_stack_is_not_imported_again(self):
        with patch.object(adoption, "aws", return_value={}) as aws:
            adoption.main()
            self.assertEqual(aws.call_count, 1)

    def test_absent_function_can_be_created_normally(self):
        with patch.object(
            adoption,
            "aws",
            side_effect=[
                missing("describe-stacks", "Stack does not exist"),
                missing("get-function", "ResourceNotFoundException"),
            ],
        ) as aws:
            adoption.main()
            self.assertEqual(aws.call_count, 2)

    def test_access_denial_is_never_treated_as_absence(self):
        with patch.object(adoption, "aws", side_effect=missing("describe-stacks", "AccessDenied")):
            with self.assertRaises(subprocess.CalledProcessError):
                adoption.main()

    def test_function_access_denial_is_never_treated_as_absence(self):
        with patch.object(
            adoption,
            "aws",
            side_effect=[
                missing("describe-stacks", "Stack does not exist"),
                missing("get-function", "AccessDenied"),
            ],
        ):
            with self.assertRaises(subprocess.CalledProcessError):
                adoption.main()

    def test_zip_function_is_not_adopted(self):
        with patch.object(
            adoption,
            "aws",
            side_effect=[
                missing("describe-stacks", "Stack does not exist"),
                {"Configuration": {"PackageType": "Zip"}},
            ],
        ):
            with self.assertRaisesRegex(RuntimeError, "container function"):
                adoption.main()

    def check_import(self, action: str):
        operations = []

        def aws(*args):
            operations.append(args)
            if args[:2] == ("cloudformation", "describe-stacks"):
                raise missing("describe-stacks", "Stack does not exist")
            if args[:2] == ("lambda", "get-function"):
                return {
                    "Configuration": {
                        "PackageType": "Image",
                        "Role": "existing-role",
                        "Architectures": ["x86_64"],
                        "MemorySize": 2048,
                        "Timeout": 900,
                        "EphemeralStorage": {"Size": 512},
                        "Environment": {"Variables": {"EXA_API_KEY": "never-copy-this"}},
                    },
                    "Code": {"ResolvedImageUri": "example/image@sha256:123"},
                }
            if args[:2] == ("cloudformation", "create-change-set"):
                template = Path(args[args.index("--template-body") + 1].removeprefix("file://"))
                content = template.read_text()
                self.assertNotIn("never-copy-this", content)
                self.assertNotIn("Environment", content)
                resource = json.loads(content)["Resources"]["DiscoveryAgent"]
                self.assertEqual(resource["DeletionPolicy"], "Retain")
                self.assertEqual(
                    resource["Properties"]["Code"]["ImageUri"], "example/image@sha256:123"
                )
                return {"Id": "import-change-set"}
            if args[:2] == ("cloudformation", "describe-change-set"):
                return {"Changes": [{"ResourceChange": {"Action": action}}]}
            return {}

        with patch.object(adoption, "aws", side_effect=aws):
            if action == "Import":
                adoption.main()
                self.assertIn(
                    (
                        "cloudformation",
                        "execute-change-set",
                        "--change-set-name",
                        "import-change-set",
                    ),
                    operations,
                )
            else:
                with self.assertRaisesRegex(RuntimeError, "refusing to execute"):
                    adoption.main()
                self.assertFalse(any(args[1] == "execute-change-set" for args in operations))

    def test_import_preserves_identity_and_never_copies_credentials(self):
        self.check_import("Import")

    def test_import_cannot_modify_existing_resources(self):
        self.check_import("Modify")

    def test_trust_is_limited_to_staging_environment_on_main(self):
        trust = json.loads((ROOT / "github-oidc-trust.json").read_text())
        statement = trust["Statement"][0]
        conditions = statement["Condition"]["StringEquals"]
        self.assertEqual(conditions["token.actions.githubusercontent.com:aud"], "sts.amazonaws.com")
        self.assertEqual(
            conditions["token.actions.githubusercontent.com:sub"],
            "repo:HARISUNDARRAJENDRAN@144145752/LearnSpace@1350314110:environment:staging",
        )
        self.assertEqual(conditions["token.actions.githubusercontent.com:ref"], "refs/heads/main")
        self.assertNotIn("*", json.dumps(trust))

    def test_deployer_reads_only_the_two_discovery_secrets(self):
        policy = json.loads((ROOT / "github-deploy-policy.json").read_text())
        secrets = next(s for s in policy["Statement"] if s["Sid"] == "ReadDeploymentSecrets")
        self.assertEqual(len(secrets["Resource"]), 2)
        self.assertTrue(all("learnspace/staging/discovery/" in arn for arn in secrets["Resource"]))
        self.assertNotIn("*", json.dumps(secrets))

    def test_pass_role_is_limited_to_the_lambda_execution_role(self):
        policy = json.loads((ROOT / "github-deploy-policy.json").read_text())
        statement = next(s for s in policy["Statement"] if s["Sid"] == "PassExecutionRoleToLambda")
        self.assertEqual(
            statement["Condition"]["StringEquals"]["iam:PassedToService"], "lambda.amazonaws.com"
        )
        self.assertTrue(
            statement["Resource"].endswith("learnspace-discovery-agent-staging-execution")
        )
        self.assertNotIn("*", json.dumps(statement))

    def test_vercel_oidc_provider_is_shared_and_read_only(self):
        policy = json.loads((ROOT / "github-deploy-policy.json").read_text())
        statement = next(
            s for s in policy["Statement"] if s["Sid"] == "ReadSharedVercelOidcProvider"
        )
        self.assertEqual(statement["Action"], "iam:GetOpenIDConnectProvider")
        self.assertEqual(
            statement["Resource"], "arn:aws:iam::934685482023:oidc-provider/oidc.vercel.com"
        )
        self.assertNotIn("*", json.dumps(statement))

    def test_worker_task_role_and_bucket_permissions_are_scoped(self):
        policy = json.loads((ROOT / "github-deploy-policy.json").read_text())
        task_role = next(s for s in policy["Statement"] if s["Sid"] == "PassWorkerTaskRole")
        self.assertEqual(task_role["Action"], "iam:PassRole")
        self.assertEqual(
            task_role["Resource"],
            "arn:aws:iam::934685482023:role/learnspace-worker-staging-task",
        )
        self.assertEqual(
            task_role["Condition"]["StringEquals"]["iam:PassedToService"],
            "ecs-tasks.amazonaws.com",
        )

        bucket = next(s for s in policy["Statement"] if s["Sid"] == "ManageStagingDocumentBucket")
        self.assertEqual(
            bucket["Resource"],
            "arn:aws:s3:::learnspace-private-documents-staging-934685482023-*",
        )
        self.assertNotIn("s3:*", bucket["Action"])
        self.assertNotIn("s3:GetObject", bucket["Action"])
        self.assertNotIn("s3:PutObject", bucket["Action"])


if __name__ == "__main__":
    unittest.main()
