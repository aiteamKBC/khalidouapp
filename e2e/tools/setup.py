"""Download pinned test-only binaries; no installer, service or machine PATH changes."""

import argparse
import hashlib
import io
import os
import platform
import tarfile
import shutil
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / ".tools"
WINDOWS = platform.system() == "Windows"
ARTIFACTS = {
    "postgres": (
        "https://repo.maven.apache.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-windows-amd64/16.16.0/embedded-postgres-binaries-windows-amd64-16.16.0.jar",
        "f9244f7a47415f8b777b6113b59209033de598965340926d992a70dcf3f557ad",
    ),
    "k6-windows": (
        "https://github.com/grafana/k6/releases/download/v2.4.0/k6-v2.4.0-windows-amd64.zip",
        "aaa90b3afc336faf90172c7addf45c4f41305f6f188e3d564f79466e80ac68e3",
    ),
    "k6-linux": (
        "https://github.com/grafana/k6/releases/download/v2.4.0/k6-v2.4.0-linux-amd64.tar.gz",
        "5a5ecf23529ccf93135bc7e5b0c1cd5126ecf5f2672e22eed1556a0ab74abb87",
    ),
    "toxiproxy-windows": (
        "https://github.com/Shopify/toxiproxy/releases/download/v2.13.0/toxiproxy-server-windows-amd64.exe",
        "04b710eefd7690c89f7cc67289e3e14618f1ff3c26e4a5f752a34a879b895bab",
    ),
    "toxiproxy-linux": (
        "https://github.com/Shopify/toxiproxy/releases/download/v2.13.0/toxiproxy-server-linux-amd64",
        "bf529e8bb9a05cd293f45a3f1d0aa66ff9469680dcdca7e0ebeae21f1b83de89",
    ),
}


def fetch(name):
    url, expected = ARTIFACTS[name]
    cache = ROOT / "downloads" / name
    cache.parent.mkdir(parents=True, exist_ok=True)
    if not cache.exists() or hashlib.sha256(cache.read_bytes()).hexdigest() != expected:
        partial = cache.with_suffix(".partial")
        print(f"Downloading {name}", flush=True)
        curl = shutil.which("curl.exe" if WINDOWS else "curl")
        if not curl:
            raise RuntimeError("curl is required to download test tools with bounded retries")
        for attempt in range(12):
            # Resume each bounded attempt; a slow link must not restart a
            # 32MB archive from zero every time the time limit is reached.
            result = subprocess.run([curl, "-fL", "--connect-timeout", "10", "--max-time", "60",
                                     "--silent", "--show-error", "-C", "-", "-o", str(partial), url],
                                    timeout=75)
            if result.returncode == 0:
                break
            if result.returncode != 28:
                raise RuntimeError(f"Download failed: {name}, curl exit {result.returncode}")
            print(f"Resuming {name}: {partial.stat().st_size} bytes downloaded", flush=True)
        else:
            raise TimeoutError(f"Download could not finish: {name}")
        if hashlib.sha256(partial.read_bytes()).hexdigest() != expected:
            raise RuntimeError(f"SHA256 mismatch for {name}; refusing to run it")
        os.replace(partial, cache)
    return cache.read_bytes()


def setup(only):
    ROOT.mkdir(exist_ok=True)
    suffix = ".exe" if WINDOWS else ""
    if only in ("all", "postgres") and WINDOWS:
        data = fetch("postgres")
        with zipfile.ZipFile(io.BytesIO(data)) as jar:
            archives = [name for name in jar.namelist() if name.endswith((".txz", ".tar.xz", ".tar.gz"))]
            assert len(archives) == 1
            with tarfile.open(fileobj=io.BytesIO(jar.read(archives[0])), mode="r:*") as archive:
                destination = ROOT / "postgres"
                for member in archive.getmembers():
                    safe = tarfile.data_filter(member, str(destination))
                    if safe is None:
                        continue
                    installed = destination / member.name
                    if member.isfile() and installed.is_file() and installed.read_bytes() == archive.extractfile(member).read():
                        continue
                    archive.extract(member, destination, filter="data")
        assert (ROOT / "postgres/bin/initdb.exe").exists()
        print("PostgreSQL 16.16 verified and ready", flush=True)
    if only in ("all", "k6"):
        data = fetch("k6-windows" if WINDOWS else "k6-linux")
        if WINDOWS:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                name = next(n for n in archive.namelist() if n.endswith("/k6.exe"))
                binary = archive.read(name)
        else:
            with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
                member = next(m for m in archive.getmembers() if m.name.endswith("/k6"))
                binary = archive.extractfile(member).read()
        target = ROOT / f"k6{suffix}"
        if not target.exists() or target.read_bytes() != binary:
            target.write_bytes(binary)
        target.chmod(0o755)
        print("k6 2.4.0 verified and ready", flush=True)
    if only in ("all", "toxiproxy"):
        data = fetch("toxiproxy-windows" if WINDOWS else "toxiproxy-linux")
        target = ROOT / f"toxiproxy-server{suffix}"
        if not target.exists() or target.read_bytes() != data:
            target.write_bytes(data)
        target.chmod(0o755)
        print("Toxiproxy 2.13.0 verified and ready", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", choices=["all", "postgres", "k6", "toxiproxy"], default="all")
    setup(parser.parse_args().only)
