#!/usr/bin/env python3
"""Back up the Oracle-hosted services and retire verified old backups."""

import argparse
import contextlib
import datetime as dt
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import shutil
import signal
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid
from zoneinfo import ZoneInfo

TARGETS = ("n8n", "nginx-proxy", "ricetta", "kw-booking")
BACKUP_NAME = re.compile(r"^oracle-services-\d{8}T\d{6}Z-[0-9a-f]{32}\.tar\.gz$")
LOG_PREFIXES = ("syslog.", "dmesg.", "btmp.", "wtmp.", "kern.log.", "auth.log.")
EXCLUDED_DIRS = {"logs", "node_modules", ".next", "__pycache__", ".venv", ".git", ".cache"}
CONFIG_DEFAULTS = {
    "home": "/home/ubuntu", "state_dir": "/var/lib/oracle-maintenance",
    "rclone_config": "/root/.config/rclone/rclone.conf", "remote": "gdrive:oracle-backups",
    "grace_seconds": 15, "health_timeout_seconds": 180, "retention_days": 7,
}


def utc_now():
    return dt.datetime.now(dt.timezone.utc)


def json_write(path, value, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, prefix=".write-", delete=False) as tmp:
        json.dump(value, tmp, separators=(",", ":"), sort_keys=True)
        tmp.write("\n")
        tmp.flush()
        os.fsync(tmp.fileno())
        temp_path = Path(tmp.name)
    os.chmod(temp_path, mode)
    os.replace(temp_path, path)


def process(args, *, capture=True):
    return subprocess.run(args, check=True, capture_output=capture, text=True)


def safe_error(stage, exc):
    if isinstance(exc, subprocess.CalledProcessError):
        program = Path(exc.cmd[0]).name
        operation = next((part for part in exc.cmd[1:] if part in {
            "stop", "start", "inspect", "prune", "rev-parse", "lsf", "copyto",
            "md5sum", "size", "moveto", "deletefile", "--rotate", "--vacuum-time=7d",
        }), "command")
        return f"{stage}:{program}.{operation}:exit{exc.returncode}"
    return f"{stage}:{type(exc).__name__}"


class Maintenance:
    def __init__(self, settings):
        self.settings = settings
        self.home = Path(settings["home"])
        self.state = Path(settings["state_dir"])
        self.remote = settings["remote"].rstrip("/")
        if ":" not in self.remote or not self.remote.endswith(":oracle-backups"):
            raise ValueError("remote must be a dedicated oracle-backups directory")
        self.rclone = ["rclone", "--config", settings["rclone_config"]]
        self.latest = self.state / "status/latest.json"
        self.restart_marker = self.state / "restart.json"
        self.monthly = self.state / "monthly.json"
        self.request_path = self.state / "requests/start.json"
        self.phase = "init"

    def status_write(self, status):
        total, used, free = shutil.disk_usage(self.state)
        status["disk"] = {
            "total_bytes": total, "used_bytes": used, "free_bytes": free,
            "used_percent": round(used / total * 100, 1) if total else 0,
        }
        json_write(self.latest, status, 0o644)

    def docker_inspect(self, names):
        if not names:
            return []
        result = json.loads(process(["docker", "inspect", *names]).stdout)
        if len(result) != len(names):
            raise RuntimeError("container inventory changed")
        return result

    def snapshot_services(self):
        names = [name for name in process(["docker", "ps", "--format", "{{.Names}}"]).stdout.splitlines() if name]
        return self.docker_inspect(names)

    @staticmethod
    def service_summaries(containers):
        return [{
            "name": item["Name"].removeprefix("/"),
            "running": bool(item["State"]["Running"]),
            "health": item["State"].get("Health", {}).get("Status", "none"),
        } for item in containers]

    def expected_mounts(self):
        ai = self.home / "my-ai-agent"
        hub = self.home / "my-assistant-hub"
        return {
            "n8n": {ai / "data/n8n"},
            "nginx-proxy": {ai / "data/nginx/config", ai / "data/nginx/letsencrypt"},
            "ricetta": {hub / "apps/ricetta/data"},
            "kw-booking": {hub / "apps/kw-hs-booking/backend/data", hub / "apps/kw-hs-booking/backend/preferences.yaml"},
        }

    def preflight(self):
        if not Path(self.settings["rclone_config"]).is_file():
            raise FileNotFoundError("rclone config is missing")
        if not self.home.is_dir():
            raise FileNotFoundError("home directory is missing")
        targets = self.docker_inspect(TARGETS)
        expected = self.expected_mounts()
        for name, item in zip(TARGETS, targets):
            if item["Name"].removeprefix("/") != name or not item["State"]["Running"]:
                raise RuntimeError("backup target unavailable")
            if any(mount["Type"] != "bind" for mount in item["Mounts"]):
                raise RuntimeError("backup target has an untracked mount")
            actual = {Path(mount["Source"]).resolve() for mount in item["Mounts"]}
            needed = {path.resolve() for path in expected[name]}
            allowed = needed | ({Path("/var/run/docker.sock").resolve()} if name == "n8n" else set())
            if not needed.issubset(actual) or not actual.issubset(allowed) or not all(path.exists() for path in needed):
                raise RuntimeError("backup target bind mounts changed")
        for path in self.required_sqlite_files():
            if not path.is_file():
                raise FileNotFoundError("required database is missing")
        self.archive_sources()
        self.recovery_commits()
        process(["docker", "network", "inspect", "proxy-net"])
        self.docker_image_inspect([item["Config"]["Image"] for item in targets])
        # Listing the drive root validates OAuth without creating the destination folder.
        process([*self.rclone, "lsf", self.remote.split(":", 1)[0] + ":"])
        process([*self.rclone, "lsf", self.remote, "--files-only", "--format", "p"])
        total, used, free = shutil.disk_usage(self.state)
        source_bytes = sum(p.stat().st_size for p in self.required_sqlite_files())
        if free < max(source_bytes * 2, 128 * 1024 * 1024):
            raise RuntimeError("insufficient scratch space")
        return self.snapshot_services()

    def required_sqlite_files(self):
        ai = self.home / "my-ai-agent"
        hub = self.home / "my-assistant-hub"
        return [
            ai / "data/n8n/database.sqlite", ai / "data/nginx/config/database.sqlite",
            hub / "apps/ricetta/data/ricetta.db",
            hub / "apps/kw-hs-booking/backend/data/reservations.db",
        ]

    def archive_sources(self):
        ai = self.home / "my-ai-agent"
        hub = self.home / "my-assistant-hub"
        mandatory = [
            ai / ".env", ai / "docker-compose.yml", ai / "docker-compose-nginx.yml",
            ai / "docker/n8n.Dockerfile", ai / "data/n8n", ai / "data/nginx",
            ai / "n8n/workflows", ai / "scripts/oracle-maintenance.py",
            hub / "apps/ricetta", hub / "apps/kw-hs-booking", hub / "packages",
        ]
        missing = [path for path in mandatory if not path.exists()]
        if missing:
            raise FileNotFoundError("required backup source is missing")
        optional = [hub / name for name in (
            "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "turbo.json", ".npmrc",
        )]
        optional.extend(hub.glob("tsconfig*.json"))
        return mandatory + [path for path in optional if path.exists()]

    @staticmethod
    def tar_filter(info):
        parts = PurePosixPath(info.name).parts
        if any(part in EXCLUDED_DIRS for part in parts):
            return None
        name = parts[-1]
        if name.endswith(".log") or ".log." in name or name.startswith(LOG_PREFIXES):
            return None
        if name.endswith(".bak") or ".bak." in name or (name.startswith("backup") and name.endswith(".tar.gz")):
            return None
        if name.endswith((".pyc", ".tmp")):
            return None
        return info

    def recovery_commits(self):
        commits = {}
        for repo in ("my-ai-agent", "my-assistant-hub"):
            location = str(self.home / repo)
            commits[repo] = process([
                "git", "-c", "safe.directory=" + location, "-C", location, "rev-parse", "HEAD",
            ]).stdout.strip()
        return commits

    def create_archive(self, path, containers):
        network = json.loads(process(["docker", "network", "inspect", "proxy-net"]).stdout)
        target_containers = [item for item in containers if item["Name"].removeprefix("/") in TARGETS]
        image_references = [item["Config"]["Image"] for item in target_containers]
        inspected_images = self.docker_image_inspect(image_references)
        metadata = {
            "containers": target_containers,
            "images": [{key: image.get(key) for key in ("Id", "RepoTags", "RepoDigests", "Created")}
                       for image in inspected_images],
            "network": network, "git_commits": self.recovery_commits(),
            "backed_up_at": utc_now().isoformat(),
        }
        with tarfile.open(path, "w:gz", format=tarfile.PAX_FORMAT, dereference=False) as tar:
            for source in self.archive_sources():
                tar.add(source, arcname=source.relative_to(self.home).as_posix(), filter=self.tar_filter)
            installed_files = []
            if self.home == Path("/home/ubuntu"):
                installed_files = [Path("/etc/oracle-maintenance/config.json")]
                installed_files.extend(Path("/etc/systemd/system").glob("oracle-maintenance*.service"))
                installed_files.extend(Path("/etc/systemd/system").glob("oracle-maintenance*.path"))
            for source in installed_files:
                if os.access(source, os.R_OK) and source.is_file():
                    tar.add(source, arcname="recovery" + source.as_posix(), recursive=False)
            content = json.dumps(metadata, separators=(",", ":")).encode()
            info = tarfile.TarInfo("recovery/metadata.json")
            info.size = len(content)
            info.mode = 0o600
            tar.addfile(info, io.BytesIO(content))
        os.chmod(path, 0o600)

    @staticmethod
    def docker_image_inspect(references):
        images = json.loads(process(["docker", "image", "inspect", *references]).stdout)
        if len(images) != len(references):
            raise RuntimeError("target image inventory changed")
        return images

    def verify_archive(self, path):
        sqlite_names = []
        with tarfile.open(path, "r:gz") as tar:
            members = tar.getmembers()
            for member in members:
                pure = PurePosixPath(member.name)
                if pure.is_absolute() or not pure.parts or ".." in pure.parts:
                    raise ValueError("archive contains unsafe member")
                if member.issym() or member.islnk():
                    relative_to = "" if member.islnk() else posixpath.dirname(member.name)
                    target = posixpath.normpath(posixpath.join(relative_to, member.linkname))
                    if member.linkname.startswith("/") or target in ("..", ".") or target.startswith("../"):
                        raise ValueError("archive contains unsafe link")
                if member.isfile():
                    source = tar.extractfile(member)
                    if source is None:
                        raise ValueError("archive member unreadable")
                    signature = source.read(16)
                    while source.read(1024 * 1024):
                        pass
                    if member.name.endswith((".sqlite", ".db")) and signature == b"SQLite format 3\x00":
                        sqlite_names.append(member.name)
        required = {path.relative_to(self.home).as_posix() for path in self.required_sqlite_files()}
        if not required.issubset(sqlite_names):
            raise RuntimeError("required database missing from archive")
        with tempfile.TemporaryDirectory(prefix="verify-", dir=self.state / "work") as private:
            root = Path(private)
            with tarfile.open(path, "r:gz") as tar:
                for name in sqlite_names:
                    for suffix in ("", "-wal", "-shm"):
                        try:
                            member = tar.getmember(name + suffix)
                        except KeyError:
                            continue
                        if not member.isfile():
                            raise ValueError("database archive member is not a file")
                        destination = root / member.name
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        source = tar.extractfile(member)
                        with destination.open("wb") as out:
                            shutil.copyfileobj(source, out)
            for name in sqlite_names:
                with sqlite3.connect("file:" + str(root / name) + "?mode=ro", uri=True) as db:
                    if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                        raise RuntimeError("SQLite integrity check failed")
        return len(sqlite_names)

    def wait_healthy(self, names):
        deadline = time.monotonic() + self.settings["health_timeout_seconds"]
        while True:
            states = self.service_summaries(self.docker_inspect(names))
            if all(item["running"] and item["health"] in ("healthy", "none") for item in states):
                return states
            if time.monotonic() >= deadline:
                raise TimeoutError("service recovery health timeout")
            time.sleep(2)

    def remove_orphan_archives(self):
        work = self.state / "work"
        if not work.is_dir() or work.is_symlink():
            return
        for path in work.iterdir():
            if re.fullmatch(r"verify-[A-Za-z0-9_-]+", path.name) and path.is_dir() and not path.is_symlink():
                shutil.rmtree(path)
            if BACKUP_NAME.fullmatch(path.name) and path.is_file() and not path.is_symlink():
                path.unlink()

    def recover(self, *, interrupted=True):
        if not self.restart_marker.exists():
            if interrupted and self.latest.exists():
                status = json.loads(self.latest.read_text())
                if status.get("state") == "running":
                    status.update(state="failed", finished_at=utc_now().isoformat(), phase="recover",
                                  error="recover:InterruptedRun")
                    self.status_write(status)
            if interrupted:
                self.remove_orphan_archives()
            return []
        marker = json.loads(self.restart_marker.read_text())
        names = marker.get("names", [])
        if not isinstance(names, list) or not set(names).issubset(TARGETS):
            raise ValueError("invalid restart marker")
        current = {item["name"]: item for item in self.service_summaries(self.docker_inspect(names))}
        stopped = [name for name in names if not current[name]["running"]]
        if stopped:
            process(["docker", "start", *stopped])
        recovered = self.wait_healthy(names)
        try:
            observed = self.service_summaries(self.snapshot_services())
        except Exception:
            observed = recovered
        self.restart_marker.unlink()
        if interrupted and self.latest.exists():
            status = json.loads(self.latest.read_text())
            if status.get("state") == "running":
                status.update(state="failed", finished_at=utc_now().isoformat(), phase="recover",
                              error="recover:InterruptedRun", services=observed)
                self.status_write(status)
        if interrupted:
            self.remove_orphan_archives()
        return names

    def read_request(self):
        try:
            request = json.loads(self.request_path.read_text())
            identifier = uuid.UUID(request["request_id"])
            timestamp = dt.datetime.fromisoformat(request["requested_at"].replace("Z", "+00:00"))
            if not timestamp.tzinfo or abs((utc_now() - timestamp.astimezone(dt.timezone.utc)).total_seconds()) > 3600:
                raise ValueError("request outside allowed time window")
            if set(request) != {"request_id", "requested_at"}:
                raise ValueError("unexpected request fields")
            return str(identifier)
        finally:
            self.request_path.unlink(missing_ok=True)

    def remote_verify(self, archive, destination):
        expected = hashlib.md5()
        with archive.open("rb") as source:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                expected.update(block)
        output = process([*self.rclone, "md5sum", destination]).stdout.strip().splitlines()
        if len(output) != 1 or not re.fullmatch(r"[0-9a-fA-F]{32}", output[0].split(maxsplit=1)[0]):
            raise RuntimeError("remote did not report a single MD5 hash")
        if output[0].split(maxsplit=1)[0].lower() != expected.hexdigest():
            raise RuntimeError("remote MD5 mismatch")
        remote_size = json.loads(process([*self.rclone, "size", destination, "--json"]).stdout)
        if remote_size.get("count") != 1 or remote_size.get("bytes") != archive.stat().st_size:
            raise RuntimeError("remote size mismatch")
        return True

    def remote_retention(self, latest):
        lines = process([*self.rclone, "lsf", self.remote, "--files-only", "--format", "p"]).stdout.splitlines()
        for name in lines:
            owned_final = BACKUP_NAME.fullmatch(name)
            owned_pending = name.endswith(".pending") and BACKUP_NAME.fullmatch(name.removesuffix(".pending"))
            if name != latest and (owned_final or owned_pending):
                process([*self.rclone, "deletefile", f"{self.remote}/{name}"])

    def cleanup_due(self):
        month = utc_now().astimezone(ZoneInfo("Asia/Seoul")).strftime("%Y-%m")
        if self.monthly.exists() and json.loads(self.monthly.read_text()).get("month") == month:
            return None
        return month

    def monthly_cleanup(self):
        # A failed action leaves the monthly marker untouched, allowing the next backup to retry.
        process(["docker", "buildx", "prune", "--all", "--force", "--filter", "until=168h"])
        process(["docker", "image", "prune", "--all", "--force"])
        process(["journalctl", "--rotate"])
        process(["journalctl", "--vacuum-time=7d"])
        cutoff = time.time() - self.settings["retention_days"] * 86400
        log_roots = [Path("/var/log"), self.home / "my-ai-agent/data/n8n", self.home / "my-ai-agent/data/nginx/config/logs"]
        for root in log_roots:
            if not root.is_dir():
                continue
            for path in root.rglob("*"):
                if not path.is_file() or path.is_symlink():
                    continue
                if root == Path("/var/log"):
                    owned = ".log." in path.name or path.name.startswith(LOG_PREFIXES)
                else:
                    owned = ".log." in path.name or bool(re.fullmatch(r"n8nEventLog-\d+\.log", path.name))
                if owned and path.stat().st_mtime < cutoff:
                    path.unlink()

    def run(self):
        try:
            run_id = self.read_request()
        except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
            status = self.initial_status(str(uuid.uuid4()))
            status.update(state="failed", finished_at=utc_now().isoformat(), phase="request",
                          error=safe_error("request", exc))
            self.status_write(status)
            return 1
        self.state.joinpath("work").mkdir(parents=True, exist_ok=True)
        os.chmod(self.state / "work", 0o700)
        status = self.initial_status(run_id)
        self.status_write(status)
        archive = None
        pending = None
        destination = None
        published_verified = False
        try:
            self.phase = "preflight"
            status["phase"] = self.phase
            self.status_write(status)
            initially_running = self.preflight()
            names = [item["Name"].removeprefix("/") for item in initially_running]
            if self.restart_marker.exists():
                raise RuntimeError("stale restart marker requires recovery")
            time.sleep(self.settings["grace_seconds"])
            stamp = utc_now().strftime("%Y%m%dT%H%M%SZ")
            backup_name = f"oracle-services-{stamp}-{uuid.uuid4().hex}.tar.gz"
            archive = self.state / "work" / backup_name
            status["backup"]["name"] = backup_name
            self.phase = "snapshot"
            status["phase"] = self.phase
            self.status_write(status)
            # Persist the exact original target set before changing any container state.
            json_write(self.restart_marker, {"names": list(TARGETS)})
            try:
                process(["docker", "stop", "--time", "60", *TARGETS])
                self.create_archive(archive, initially_running)
                status["backup"]["bytes"] = archive.stat().st_size
            finally:
                self.recover(interrupted=False)
            self.phase = "health"
            status["phase"] = self.phase
            self.status_write(status)
            status["services"] = self.wait_healthy(names)
            self.phase = "verify"
            status["phase"] = self.phase
            self.status_write(status)
            status["backup"]["sqlite_count"] = self.verify_archive(archive)
            existing = process([*self.rclone, "lsf", self.remote, "--files-only", "--format", "p"]).stdout.splitlines()
            if backup_name in existing or backup_name + ".pending" in existing:
                raise RuntimeError("generated backup name already exists")
            destination = f"{self.remote}/{backup_name}"
            pending = destination + ".pending"
            self.phase = "upload"
            status["phase"] = self.phase
            self.status_write(status)
            process([*self.rclone, "copyto", str(archive), pending])
            self.remote_verify(archive, pending)
            process([*self.rclone, "moveto", pending, destination])
            self.remote_verify(archive, destination)
            published_verified = True
            status["backup"].update(state="success", verified=True)
            self.phase = "retention"
            status["phase"] = self.phase
            self.status_write(status)
            self.remote_retention(backup_name)
            archive.unlink()
            archive = None
            month = self.cleanup_due()
            status["cleanup"]["month"] = month
            if month:
                self.phase = "cleanup"
                status["phase"] = self.phase
                self.status_write(status)
                try:
                    self.monthly_cleanup()
                    json_write(self.monthly, {"month": month})
                    status["cleanup"]["state"] = "success"
                except Exception as exc:
                    status["cleanup"].update(state="failed", error=safe_error("cleanup", exc))
                    status["state"] = "partial"
            self.phase = "final-health"
            try:
                status["services"] = self.wait_healthy(names)
            except Exception as exc:
                status["state"] = "partial"
                status["error"] = safe_error("final-health", exc)
                try:
                    status["services"] = self.service_summaries(self.docker_inspect(names))
                except Exception:
                    pass
            status["state"] = status["state"] if status["state"] == "partial" else "success"
            status["phase"] = "done"
            status["finished_at"] = utc_now().isoformat()
            self.status_write(status)
            return 0
        except Exception as exc:
            try:
                self.recover()
            except Exception:
                pass  # The durable restart marker is retained for ExecStopPost or boot recovery.
            finally:
                if archive is not None:
                    archive.unlink(missing_ok=True)
            if not published_verified:
                for unverified in (pending, destination):
                    if unverified is None:
                        continue
                    try:
                        process([*self.rclone, "deletefile", unverified])
                    except Exception:
                        pass
            status["state"] = "failed"
            status["finished_at"] = utc_now().isoformat()
            status["phase"] = self.phase
            status["error"] = safe_error(self.phase, exc)
            status["backup"]["error"] = status["error"]
            try:
                status["services"] = self.service_summaries(self.snapshot_services())
            except Exception:
                pass
            self.status_write(status)
            return 1

    @staticmethod
    def initial_status(run_id):
        return {
            "run_id": run_id, "state": "running", "started_at": utc_now().isoformat(),
            "finished_at": None, "phase": "init", "error": None,
            "backup": {"state": "pending", "name": None, "bytes": 0, "sqlite_count": 0,
                       "verified": False, "error": None},
            "cleanup": {"state": "skipped", "month": None, "error": None},
            "disk": None, "services": [],
        }


@contextlib.contextmanager
def locked(state):
    state.mkdir(parents=True, exist_ok=True)
    with (state / "run.lock").open("a") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def load_settings(path):
    settings = CONFIG_DEFAULTS.copy()
    if path.is_file():
        values = json.loads(path.read_text())
        if not isinstance(values, dict) or set(values) - set(settings):
            raise ValueError("invalid config keys")
        settings.update(values)
    return settings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", nargs="?", choices=("run", "recover", "preflight", "status"), default="run")
    parser.add_argument("--config", default="/etc/oracle-maintenance/config.json")
    args = parser.parse_args()
    runner = Maintenance(load_settings(Path(args.config)))
    if args.action == "status":
        if runner.latest.exists():
            print(runner.latest.read_text(), end="")
        else:
            print("{}")
        return 0
    if args.action == "preflight":
        runner.preflight()
        print("preflight ok")
        return 0
    if args.action == "run":
        def stop_requested(_signum, _frame):
            raise InterruptedError("maintenance interrupted")
        signal.signal(signal.SIGTERM, stop_requested)
    try:
        with locked(runner.state):
            if args.action == "recover":
                runner.recover()
                return 0
            return runner.run()
    except BlockingIOError:
        # The path watcher must not spin on the same request while a prior job is active.
        if args.action == "run":
            runner.request_path.unlink(missing_ok=True)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
