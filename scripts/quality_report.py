"""Validate a complete quality report against the exact current source contents."""

import argparse
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def fingerprint():
    files = subprocess.check_output(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], cwd=ROOT)
    digest = hashlib.sha256()
    for name in sorted(set(files.decode("utf-8").split("\0")) - {""}):
        path = ROOT / name
        digest.update(name.encode("utf-8") + b"\0")
        data = path.read_bytes() if path.is_file() else b"<deleted>"
        # Git/Vite can normalize checked-out text on Windows. Equivalent line
        # endings do not change what was tested or invalidate a clean CI run.
        if b"\0" not in data:
            data = data.replace(b"\r\n", b"\n")
        digest.update(data)
    return digest.hexdigest()


def validate(path):
    report = json.loads(path.read_text(encoding="utf-8"))
    required = {"backend", "desktop", "desktop-lint", "dashboard", "postgres-contract", "playwright", "load", "stack-stop", "process-lifecycle"}
    passed = {step["name"] for step in report.get("steps", []) if step.get("status") == "passed"}
    if report.get("status") != "passed" or report.get("suite") != "all" or not required <= passed:
        raise ValueError("A complete passing all-suite report is required before deployment")
    if report.get("source_fingerprint") != fingerprint():
        raise ValueError("Source changed since the tests; run scripts/test-khaliduo.ps1 -Suite all again")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    args = parser.parse_args()
    validate(args.report)
    print("Quality report matches current source; all required checks passed.")
