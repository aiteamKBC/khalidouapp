import importlib.util
import json
import subprocess
from pathlib import Path

import pytest


@pytest.fixture()
def gate(tmp_path):
    source = Path(__file__).resolve().parents[2] / "scripts/quality_report.py"
    spec = importlib.util.spec_from_file_location("quality_gate_under_test", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.ROOT = tmp_path
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    (tmp_path / "app.py").write_bytes(b"print('tested')\r\n")
    subprocess.run(["git", "-C", str(tmp_path), "add", "app.py"], check=True)
    # The report lives outside the source tree it describes.
    report = tmp_path.parent / f"{tmp_path.name}.json"
    data = {"status": "passed", "suite": "all", "source_fingerprint": module.fingerprint(),
            "steps": [{"name": name, "status": "passed"} for name in
                      ["backend", "desktop", "desktop-lint", "dashboard", "postgres-contract", "playwright", "load", "stack-stop", "process-lifecycle"]]}
    report.write_text(json.dumps(data), encoding="utf-8")
    return module, tmp_path, report, data


def test_deployment_accepts_complete_report_with_equivalent_text_line_endings(gate):
    module, root, report, _ = gate
    (root / "app.py").write_bytes(b"print('tested')\n")
    assert module.validate(report)["status"] == "passed"


def test_deployment_rejects_source_changed_since_test(gate):
    module, root, report, _ = gate
    (root / "app.py").write_text("print('untested change')\n")
    with pytest.raises(ValueError, match="Source changed"):
        module.validate(report)


@pytest.mark.parametrize("missing", ["load", "playwright", "backend", "postgres-contract", "process-lifecycle"])
def test_deployment_rejects_partial_quality_reports(gate, missing):
    module, _, report, data = gate
    data["steps"] = [step for step in data["steps"] if step["name"] != missing]
    report.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(ValueError, match="complete passing"):
        module.validate(report)
