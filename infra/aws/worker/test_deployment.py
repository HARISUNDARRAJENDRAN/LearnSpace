import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).parent
spec = importlib.util.spec_from_file_location("runtime", ROOT / "configure-runtime.py")
assert spec and spec.loader
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class DeploymentTests(unittest.TestCase):
    def test_runtime_preserves_credentials_and_rejects_incomplete_configuration(self):
        credentials = {"OPENAI_API_KEY": "private-key", "KV_REST_API_URL": "https://redis.test",
                       "KV_REST_API_TOKEN": "private-token", "DATABASE_WORKER_URL": "old"}
        writes = []

        def aws(args, **kwargs):
            if "get-secret-value" in args:
                return subprocess.CompletedProcess(args, 0, json.dumps(credentials))
            path = args[args.index("--secret-string") + 1].removeprefix("file://")
            writes.append(json.loads(Path(path).read_text()))
            return subprocess.CompletedProcess(args, 0)

        with patch.dict(os.environ, {"WORKER_RUNTIME_SECRET_ARN": "test-secret",
                                     "DATABASE_WORKER_URL": "new"}), \
                patch.object(runtime.subprocess, "run", side_effect=aws):
            runtime.main()
            self.assertEqual(writes, [{**credentials, "DATABASE_WORKER_URL": "new"}])
            del credentials["OPENAI_API_KEY"]
            with self.assertRaisesRegex(RuntimeError, "required credential"):
                runtime.main()
            self.assertEqual(len(writes), 1)

    def test_deployment_rejects_a_stable_service_running_another_build_or_image(self):
        with tempfile.TemporaryDirectory() as directory:
            aws = Path(directory) / "aws"
            aws.write_text("""#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
if args[:2] == ['sts', 'get-caller-identity']:
    print('123')
elif args[:2] == ['ecr', 'describe-images'] and '--query' in args:
    print('sha256:expected')
elif args[:2] == ['ecs', 'describe-services']:
    print(json.dumps({'services': [{'runningCount': 1, 'pendingCount': 0,
        'taskDefinition': 'test-task', 'deployments': [{'rolloutState': 'COMPLETED'}]}]}))
elif args[:2] == ['ecs', 'describe-task-definition']:
    print(json.dumps({'containerDefinitions': [{'name': 'worker',
        'image': os.environ['TEST_IMAGE'],
        'environment': [{'name': 'WORKER_BUILD_SHA', 'value': os.environ['TEST_BUILD']}]}]}))
""")
            aws.chmod(0o755)
            docker = Path(directory) / "docker"
            docker.write_text("#!/bin/sh\ncat >/dev/null\n")
            docker.chmod(0o755)
            image = "123.dkr.ecr.test.amazonaws.com/learnspace-backend-staging@sha256:expected"
            env = {**os.environ, "PATH": f"{directory}:{os.environ['PATH']}",
                   "AWS_REGION": "test", "GITHUB_SHA": "current-build",
                   "WORKER_RUNTIME_SECRET_ARN": "runtime",
                   "INTERNAL_SERVICE_TOKEN_SECRET_ARN": "token",
                   "DISCOVERY_AGENT_URL": "https://agent.test", "WORKER_VPC_ID": "vpc-test",
                   "WORKER_SUBNET_IDS": "subnet-test", "TEST_IMAGE": image}
            for build, deployed_image, expected in [
                ("current-build", image, 0), ("previous-build", image, 1),
                ("current-build", "wrong-image", 1),
            ]:
                result = subprocess.run(
                    ["bash", str(ROOT / "deploy.sh")], capture_output=True, text=True,
                    env={**env, "TEST_BUILD": build, "TEST_IMAGE": deployed_image}, check=False,
                )
                self.assertEqual(result.returncode, expected, result.stderr)
                self.assertEqual("WORKER_VERIFIED" in result.stdout, expected == 0)


if __name__ == "__main__":
    unittest.main()
