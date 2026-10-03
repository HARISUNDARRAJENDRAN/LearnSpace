import subprocess
import sys


def test_service_startup_does_not_eagerly_import_agent_ml_stack() -> None:
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys; import app.main; "
            "assert not any(name in sys.modules for name in "
            "('crewai', 'crewai_tools', 'chromadb', 'torch', 'transformers'))",
        ],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, result.stderr
