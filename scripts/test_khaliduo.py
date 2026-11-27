"""One entry point for generated scenarios, UI, network chaos and authenticated load."""

import argparse
import glob
import json
import os
import secrets
import shutil
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

from quality_report import fingerprint

ROOT = Path(__file__).resolve().parents[1]
WINDOWS = os.name == "nt"


def main():
    # GitHub's Windows console may use a legacy code page even when subprocess
    # logs are UTF-8. Preserve the original failure instead of failing to print it.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", choices=["quick", "nightly"], default="quick")
    parser.add_argument("--suite", choices=["all", "unit", "integration", "load", "native"], default="all")
    parser.add_argument("--seed", type=int, default=secrets.randbelow(2**31))
    parser.add_argument("--install-tools", action="store_true")
    parser.add_argument("--include-sleep", action="store_true")
    args = parser.parse_args()
    name = datetime.now(UTC).strftime("%Y%m%d-%H%M%S-%f") + f"-{args.seed}"
    report = ROOT / "test-reports" / name
    report.mkdir(parents=True, exist_ok=False)
    initial_source = fingerprint()
    result = {"profile": args.profile, "suite": args.suite, "seed": args.seed, "status": "running", "steps": [], "source_fingerprint": initial_source}
    env = dict(os.environ, KHALIDUO_TEST_PROFILE=args.profile, FC_SEED=str(args.seed), PYTHONUTF8="1",
               KHALIDUO_TEST_PYTHON=sys.executable)
    node = shutil.which("node")
    npm = shutil.which("npm.cmd" if WINDOWS else "npm")
    npx = shutil.which("npx.cmd" if WINDOWS else "npx")
    stack_up = False

    def save():
        (report / "summary.json").write_text(json.dumps(result, indent=2), encoding="utf-8")

    def step(label, command, cwd=ROOT, extra=None, timeout=1800):
        if any(value is None for value in command):
            raise RuntimeError(f"A required executable is missing for {label}")
        log = report / (label + ".log")
        print(f"[quality] {label} (seed {args.seed})", flush=True)
        started = time.monotonic()
        with log.open("w", encoding="utf-8") as output:
            proc = subprocess.run(command, cwd=cwd, env={**env, **(extra or {})},
                                  stdout=output, stderr=subprocess.STDOUT, timeout=timeout)
        result["steps"].append({"name": label, "status": "passed" if proc.returncode == 0 else "failed",
                                "seconds": round(time.monotonic() - started, 2), "exit_code": proc.returncode,
                                "log": log.name})
        save()
        if proc.returncode:
            print(log.read_text(encoding="utf-8", errors="replace")[-9000:], flush=True)
            raise RuntimeError(f"{label} failed; see {log}")
        print(f"[quality] {label}: passed", flush=True)

    try:
        if args.suite == "native":
            shell = shutil.which("powershell.exe" if WINDOWS else "pwsh")
            command = [shell, "-NoProfile", "-File", str(ROOT / "e2e/native/Test-WindowsTime.ps1"), "-Report", str(report / "native.json")]
            if args.include_sleep:
                command.append("-IncludeSleep")
            step("native-windows", command)
        if args.suite in ("all", "unit"):
            step("backend", [sys.executable, "-m", "pytest", "-q", f"--hypothesis-seed={args.seed}",
                             f"--junitxml={report / 'backend.xml'}"], ROOT / "backend",
                 {"APP_ENV": "testing", "DATABASE_URL": "sqlite:///:memory:"})
            step("desktop", [npm, "test"], ROOT / "frontend/desktop-agent")
            step("desktop-lint", [npm, "run", "lint"], ROOT / "frontend/desktop-agent")
            dashboard = ROOT / "frontend/admin-dashboard"
            files = sorted(glob.glob(str(dashboard / "src/lib/*.test.ts")))
            files.append(str(dashboard / "src/components/employee-workspace/adapters.test.ts"))
            step("dashboard", [node, "--test", *files], dashboard)
        if args.suite in ("all", "integration", "load"):
            if args.install_tools:
                step("tools", [sys.executable, str(ROOT / "e2e/tools/setup.py")])
                step("browser", [npx, "playwright", "install", "chromium"], ROOT / "e2e")
            # Electron 43 downloads its native runtime on first CLI use. The
            # Playwright executablePath bypasses that CLI, so install explicitly.
            step("electron-runtime", [node, str(ROOT / "frontend/desktop-agent/node_modules/electron/install.js")])
            step("desktop-build", [npm, "run", "build"], ROOT / "frontend/desktop-agent", {
                "VITE_API_BASE_URL": "http://127.0.0.1:8011/api/v1",
                "KHALIDUO_EMPLOYEE_PORTAL_URL": "http://127.0.0.1:5175/employee",
            })
            step("stack-start", [node, str(ROOT / "e2e/lib/up.ts")])
            stack_up = True
            step("postgres-contract", [node, str(ROOT / "e2e/lib/contracts.ts")], extra={"KHALIDUO_PG_REPORT": str(report / "postgres-http.xml")})
            if args.suite != "load":
                projects = ["desktop", "chaos"] if args.profile == "quick" else ["desktop", "chaos", "web", "journey"]
                step("playwright", [npx, "playwright", "test", *[f"--project={p}" for p in projects]], ROOT / "e2e",
                     {"E2E_REUSE_STACK": "1"}, timeout=3600)
            if args.suite in ("all", "load"):
                step("load", [node, str(ROOT / "e2e/lib/load.ts")], extra={"KHALIDUO_K6_REPORT": str(report / "k6.json")})
        result["status"] = "passed"
    except (Exception, KeyboardInterrupt) as error:
        result["status"] = "failed"
        result["error"] = str(error)
        print(f"[quality] {error}", flush=True)
    finally:
        if stack_up:
            try:
                step("stack-stop", [node, str(ROOT / "e2e/lib/down.ts")], extra={"E2E_REUSE_STACK": "0"}, timeout=60)
            except Exception as error:
                result["status"] = "failed"
                result["cleanup_error"] = str(error)
        if result["status"] == "passed" and fingerprint() != initial_source:
            result["status"] = "failed"
            result["error"] = "Source changed while tests were running; rerun against the final source"
        save()
        print(f"[quality] Report: {report / 'summary.json'}", flush=True)
    return 0 if result["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
