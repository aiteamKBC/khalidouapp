"""Copy only the existing salary key from the VPS into the local backend .env.

Run in an interactive terminal so OpenSSH can prompt for the server password.
The key travels over SSH into a captured pipe and is never printed or passed as
a command-line argument. No remote writes, database operations, or migrations.
"""

import argparse
import json
from pathlib import Path, PurePosixPath
import shlex
import subprocess

from dotenv import dotenv_values, set_key

BACKEND = Path(__file__).resolve().parents[1]


def restore_key(env_file: Path, server: str, app_root: str, runner=subprocess.run) -> None:
    if not env_file.is_file():
        raise RuntimeError("Local backend/.env is missing. Configure the intended database first.")
    if dotenv_values(env_file).get("SALARY_ENCRYPTION_KEY"):
        raise RuntimeError("backend/.env already contains SALARY_ENCRYPTION_KEY; it was not replaced.")
    if server.startswith("-"):
        raise RuntimeError("Invalid SSH server.")

    root = PurePosixPath(app_root)
    remote_code = (
        "import json,sys; from dotenv import dotenv_values; "
        f"values=dotenv_values({str(root / 'backend' / '.env')!r}); "
        "key=values.get('SALARY_ENCRYPTION_KEY') or ''; "
        "sys.exit('The server .env has no valid salary key.') if len(key)<32 else None; "
        "sys.stdout.write(json.dumps({'salary_key':key}))"
    )
    remote_command = shlex.join([str(root / "venv" / "bin" / "python"), "-c", remote_code])
    try:
        result = runner(
            ["ssh", "-T", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=10",
             server, remote_command],
            stdout=subprocess.PIPE,
            # Leave stderr/console attached for SSH authentication prompts.
            text=True,
            timeout=180,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError("SSH could not complete. Local configuration was not changed.") from None
    if result.returncode:
        raise RuntimeError("SSH/key retrieval failed. Local configuration was not changed.")
    try:
        key = json.loads(result.stdout)["salary_key"]
        if not isinstance(key, str) or len(key) < 32 or "\n" in key or "\r" in key:
            raise ValueError
    except (ValueError, KeyError, TypeError):
        raise RuntimeError("The server did not return a valid key. Local configuration was not changed.") from None
    # Recheck after authentication in case the user edited .env while we waited.
    if dotenv_values(env_file).get("SALARY_ENCRYPTION_KEY"):
        raise RuntimeError("A local key was configured while SSH ran; it was not replaced.")
    set_key(env_file, "SALARY_ENCRYPTION_KEY", key, quote_mode="always")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server", default="root@72.62.133.105")
    parser.add_argument("--app-root", default="/var/www/khalidouapp")
    args = parser.parse_args()
    print("Restoring the existing backend salary key over SSH. Enter the VPS password if prompted.")
    try:
        restore_key(BACKEND / ".env", args.server, args.app_root)
    except RuntimeError as error:
        print(f"ERROR: {error}")
        return 1
    print("Restored SALARY_ENCRYPTION_KEY in backend/.env. No secret values were printed.")
    print("Run npm run check:env, then restart the local API. The server was not changed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
