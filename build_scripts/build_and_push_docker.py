#!/usr/bin/env python3
from __future__ import annotations

"""
Single local deployment entrypoint.

The filename is kept for compatibility with existing CICD wiring, but the
script now only handles local Git sync, Docker build, docker compose rollout,
health checks, and rollback on the same machine.
"""

import argparse
import fcntl
import json
import os
import re
import shlex
import subprocess
import sys
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import urlopen


DEFAULT_TAG_SUFFIX = "localdeploy"
DEFAULT_VERSION_SOURCE = "auto"
DEFAULT_REMOTE = "origin"
DEFAULT_LOCK_TIMEOUT_SECONDS = 600
DEFAULT_APP_ENV_FILE = ".env"
DEFAULT_COMPOSE_FILE = "compose.yaml"
DEFAULT_BIND_IP = "127.0.0.1"
DEFAULT_PORT = "3100"
DEFAULT_HEALTH_PATH = "health"
DEFAULT_KEEP_RELEASES = 5
DEFAULT_BUILDER_PRUNE_UNTIL = "168h"
STATE_DIR_NAME = ".deploy"
STATE_FILE_NAME = "deploy_state.json"
LOCK_FILE_NAME = "deploy.lock"
COMPOSE_ENV_FILE_NAME = "compose.env"
DEFAULT_SLOT = "default"
TAG_VERSION_PATTERNS = (
    re.compile(r"^(?:version/)?(?P<version>\d{8}_\d{3})$", re.IGNORECASE),
    re.compile(r"^(?:version/)?v?(?P<version>\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?)$", re.IGNORECASE),
)
COMMIT_VERSION_PATTERNS = (
    re.compile(r"\bversion/(?P<version>\d{8}_\d{3})\b", re.IGNORECASE),
    re.compile(r"\bversion[:=\s]+(?P<version>\d{8}_\d{3})\b", re.IGNORECASE),
    re.compile(r"\brelease[:=\s]+(?P<version>\d{8}_\d{3})\b", re.IGNORECASE),
    re.compile(r"\bversion/v?(?P<version>\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?)\b", re.IGNORECASE),
    re.compile(r"\bversion[:=\s]+v?(?P<version>\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?)\b", re.IGNORECASE),
    re.compile(r"\brelease[:=\s]+v?(?P<version>\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?)\b", re.IGNORECASE),
)


class ScriptError(RuntimeError):
    """Raised when the deployment script cannot continue safely."""


def get_time() -> float:
    return time.monotonic()


def print_time(seconds: float) -> str:
    return f"{seconds:.1f}s"


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def format_command(command: list[str]) -> str:
    return " ".join(shlex.quote(part) for part in command)


def run_command(
    command: list[str],
    *,
    cwd: Path | None = None,
    capture_output: bool = False,
    stdin_text: str | None = None,
) -> subprocess.CompletedProcess[str]:
    print(f"+ {format_command(command)}")
    return subprocess.run(
        command,
        cwd=str(cwd) if cwd else None,
        check=True,
        text=True,
        input=stdin_text,
        capture_output=capture_output,
    )


def command_output(command: list[str], *, cwd: Path | None = None) -> str:
    result = run_command(command, cwd=cwd, capture_output=True)
    return result.stdout.strip()


def git_output(repo_root: Path, *args: str) -> str:
    result = run_command(["git", *args], cwd=repo_root, capture_output=True)
    return result.stdout.strip()


def git_lines(repo_root: Path, *args: str) -> list[str]:
    output = git_output(repo_root, *args)
    if not output:
        return []
    return [line.strip() for line in output.splitlines() if line.strip()]


def resolve_repo_root(start: Path) -> Path:
    try:
        repo_root = git_output(start, "rev-parse", "--show-toplevel")
    except subprocess.CalledProcessError as error:
        raise ScriptError("Current directory is not inside a Git repository.") from error
    return Path(repo_root).resolve()


def sanitize_image_name(raw_value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9._-]+", "-", raw_value.lower()).strip("._-")
    if not cleaned:
        raise ScriptError(f"Image name {raw_value!r} cannot be converted to a valid Docker image name.")
    return cleaned


def sanitize_tag_component(raw_value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9._-]+", "-", raw_value.lower()).strip("._-")
    return cleaned or "unknown"


def sanitize_slot(raw_value: str | None) -> str:
    cleaned = sanitize_image_name((raw_value or DEFAULT_SLOT).strip())
    return cleaned or DEFAULT_SLOT


def strip_wrapping_quotes(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def load_env_file(path: Path) -> dict[str, str]:
    loaded: dict[str, str] = {}
    with path.open("r", encoding="utf-8") as file:
        for line_number, raw_line in enumerate(file, start=1):
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[len("export ") :].strip()
            if "=" not in line:
                raise ScriptError(f"Invalid env line at {path}:{line_number}: {raw_line.rstrip()}")

            key, value = line.split("=", 1)
            key = key.strip()
            value = strip_wrapping_quotes(value.strip())
            loaded[key] = value
            os.environ[key] = value

    return loaded


def find_env_file(repo_root: Path, image_name: str, explicit_env_file: str | None) -> Path | None:
    candidates: list[Path] = []
    if explicit_env_file:
        explicit_path = Path(explicit_env_file).expanduser()
        if not explicit_path.is_absolute():
            explicit_path = repo_root / explicit_path
        explicit_path = explicit_path.resolve()
        if not explicit_path.exists():
            raise ScriptError(f"Env file not found: {explicit_path}")
        candidates.append(explicit_path)

    candidates.append(repo_root / ".env")
    candidates.append(Path.home() / ".zook" / f"{image_name}.env")

    for candidate in candidates:
        if candidate.exists():
            return candidate.resolve()

    return None


def get_git_status(repo_root: Path) -> str:
    return git_output(repo_root, "status", "--porcelain")


def assert_repo_ready_for_sync(repo_root: Path, *, skip_git_sync: bool, allow_dirty: bool) -> bool:
    status = get_git_status(repo_root)
    if not status:
        return False

    if skip_git_sync:
        if allow_dirty:
            return True
        raise ScriptError(
            "Git repository is not clean. Commit or stash your changes first, or rerun with --allow-dirty when using --skip-git-sync.\n"
            f"{status}"
        )

    raise ScriptError(
        "Git repository is not clean. This deployment flow updates the checkout with git fetch/checkout/reset, so it refuses to overwrite local changes.\n"
        f"{status}"
    )


def build_image_tag(branch: str, git_hash: str, suffix: str, version: str | None = None) -> str:
    suffix = sanitize_tag_component(suffix)
    version_slug = sanitize_tag_component(version) if version else None
    reserved = len(f"-{git_hash}-{suffix}")
    if version_slug:
        reserved += len(f"-{version_slug}")
    branch_budget = max(12, 128 - reserved)
    branch_slug = sanitize_tag_component(branch)[:branch_budget].rstrip("._-") or "detached"
    if version_slug:
        return f"{branch_slug}-{version_slug}-{git_hash}-{suffix}"
    return f"{branch_slug}-{git_hash}-{suffix}"


def extract_version_from_tag_name(tag_name: str) -> str | None:
    raw_tag = tag_name.strip()
    for pattern in TAG_VERSION_PATTERNS:
        match = pattern.fullmatch(raw_tag)
        if match:
            return sanitize_tag_component(match.group("version"))
    return None


def extract_version_from_commit_text(commit_text: str) -> str | None:
    for pattern in COMMIT_VERSION_PATTERNS:
        match = pattern.search(commit_text)
        if match:
            return sanitize_tag_component(match.group("version"))
    return None


def find_version_from_git_tags(repo_root: Path) -> tuple[str | None, str | None]:
    head_tags = git_lines(repo_root, "tag", "--points-at", "HEAD")
    for tag_name in head_tags:
        version = extract_version_from_tag_name(tag_name)
        if version:
            return version, f"git-tag:{tag_name}"

    merged_tags = git_lines(
        repo_root,
        "for-each-ref",
        "--merged",
        "HEAD",
        "--sort=-creatordate",
        "--format=%(refname:short)",
        "refs/tags",
    )
    for tag_name in merged_tags:
        version = extract_version_from_tag_name(tag_name)
        if version:
            return version, f"git-tag:{tag_name}"

    return None, None


def find_version_from_git_commit(repo_root: Path) -> tuple[str | None, str | None]:
    commit_text = git_output(repo_root, "log", "-1", "--pretty=%s%n%b")
    version = extract_version_from_commit_text(commit_text)
    if version:
        return version, "git-commit-message"
    return None, None


def resolve_version(repo_root: Path, version_source: str) -> tuple[str | None, str | None]:
    if version_source == "none":
        return None, None

    if version_source in {"auto", "tag"}:
        version, source = find_version_from_git_tags(repo_root)
        if version:
            return version, source
        if version_source == "tag":
            raise ScriptError(
                "No version tag found. Supported tag formats include version/20260310_001, 1.2.3, v1.2.3, version/1.2.3, version/v1.2.3."
            )

    if version_source in {"auto", "commit"}:
        version, source = find_version_from_git_commit(repo_root)
        if version:
            return version, source
        if version_source == "commit":
            raise ScriptError(
                "No version marker found in the latest commit message. Supported examples: version/20260310_001, version/1.2.3, version: 1.2.3."
            )

    return None, None


def normalize_health_path(raw_value: str | None) -> str:
    cleaned = (raw_value or DEFAULT_HEALTH_PATH).strip().strip("/")
    return cleaned or DEFAULT_HEALTH_PATH


def ensure_existing_file(path: Path, description: str) -> Path:
    resolved = path.expanduser()
    if not resolved.is_absolute():
        resolved = resolved.resolve()
    if not resolved.exists():
        raise ScriptError(f"{description} not found: {resolved}")
    return resolved


def resolve_branch(repo_root: Path, requested_branch: str | None) -> str:
    branch = (requested_branch or git_output(repo_root, "branch", "--show-current")).strip()
    if not branch:
        raise ScriptError("Cannot determine which Git branch to deploy.")
    return branch


def sync_checkout(repo_root: Path, remote: str, branch: str, commit: str | None) -> None:
    target_ref = commit or f"{remote}/{branch}"
    run_command(["git", "fetch", remote, "--tags"], cwd=repo_root)
    run_command(["git", "checkout", "-B", branch, target_ref], cwd=repo_root)


def parse_image_reference(image_ref: str) -> tuple[str, str | None]:
    last_slash = image_ref.rfind("/")
    last_colon = image_ref.rfind(":")
    if last_colon <= last_slash:
        return image_ref, None
    return image_ref[:last_colon], image_ref[last_colon + 1 :]


def release_from_image(image_ref: str) -> dict[str, str] | None:
    image_name, image_tag = parse_image_reference(image_ref)
    if not image_tag:
        return None
    return {
        "image": image_ref,
        "image_name": image_name,
        "image_tag": image_tag,
    }


def load_state(state_file: Path) -> dict[str, object]:
    if not state_file.exists():
        return {}
    with state_file.open("r", encoding="utf-8") as file:
        return json.load(file)


def write_state(state_file: Path, payload: dict[str, object]) -> None:
    state_file.parent.mkdir(parents=True, exist_ok=True)
    state_file.write_text(json.dumps(payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")


def encode_env_value(value: str) -> str:
    if re.search(r"\s|#|['\"]", value):
        return json.dumps(value)
    return value


def write_compose_env(path: Path, values: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [f"{key}={encode_env_value(value)}" for key, value in values.items()]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def get_service_container_id(project_name: str, service_name: str) -> str | None:
    try:
        output = command_output(
            [
                "docker",
                "ps",
                "-aq",
                "--filter",
                f"label=com.docker.compose.project={project_name}",
                "--filter",
                f"label=com.docker.compose.service={service_name}",
            ]
        )
    except subprocess.CalledProcessError:
        return None
    container_ids = [line for line in output.splitlines() if line.strip()]
    return container_ids[0] if container_ids else None


def get_service_image(project_name: str, service_name: str) -> str | None:
    container_id = get_service_container_id(project_name, service_name)
    if not container_id:
        return None
    return command_output(["docker", "inspect", "--format", "{{.Config.Image}}", container_id])


def get_service_status(project_name: str, service_name: str) -> str | None:
    container_id = get_service_container_id(project_name, service_name)
    if not container_id:
        return None
    return command_output(["docker", "inspect", "--format", "{{.State.Status}}", container_id])


def compose_command(project_name: str, compose_file: Path, compose_env_file: Path, *extra_args: str) -> list[str]:
    return [
        "docker",
        "compose",
        "--project-name",
        project_name,
        "--env-file",
        str(compose_env_file),
        "-f",
        str(compose_file),
        *extra_args,
    ]


def collect_compose_logs(project_name: str, compose_file: Path, compose_env_file: Path) -> str:
    try:
        return command_output(
            compose_command(project_name, compose_file, compose_env_file, "logs", "--no-color", "--tail", "200", "api", "worker")
        )
    except subprocess.CalledProcessError:
        return ""


def check_http_health(bind_ip: str, host_port: str, health_path: str) -> bool:
    url = f"http://{bind_ip}:{host_port}/{health_path}"
    try:
        with urlopen(url, timeout=2) as response:
            return 200 <= response.status < 400
    except Exception:
        return False


def wait_for_release(project_name: str, bind_ip: str, host_port: str, health_path: str, timeout_seconds: int = 60) -> bool:
    deadline = time.monotonic() + timeout_seconds
    last_state = ""
    while time.monotonic() < deadline:
        api_status = get_service_status(project_name, "api")
        worker_status = get_service_status(project_name, "worker")
        healthy = check_http_health(bind_ip, host_port, health_path)
        current_state = f"api={api_status} worker={worker_status} healthy={healthy}"
        if current_state != last_state:
            print(f"wait release status: {current_state}")
            last_state = current_state
        if api_status == "running" and worker_status == "running" and healthy:
            return True
        time.sleep(2)
    return False


def build_local_image(repo_root: Path, dockerfile_path: Path, image_full_name: str, image_name: str, image_tag: str, commit_sha: str) -> None:
    build_date = now_iso()
    run_command(
        [
            "docker",
            "build",
            "-t",
            image_full_name,
            "-f",
            str(dockerfile_path),
            "--build-arg",
            f"APP_NAME={image_name}",
            "--build-arg",
            f"APP_VERSION={image_tag}",
            "--build-arg",
            f"GIT_SHA={commit_sha}",
            "--build-arg",
            f"BUILD_DATE={build_date}",
            str(repo_root),
        ],
        cwd=repo_root,
    )


def deploy_release(repo_root: Path, project_name: str, compose_file: Path, compose_env_file: Path) -> None:
    run_command(
        compose_command(project_name, compose_file, compose_env_file, "up", "-d", "--force-recreate", "--remove-orphans"),
        cwd=repo_root,
    )


def resolve_runtime_paths(repo_root: Path, args: argparse.Namespace) -> tuple[Path, Path, Path]:
    compose_file = Path(args.compose_file)
    if not compose_file.is_absolute():
        compose_file = repo_root / compose_file
    compose_file = ensure_existing_file(compose_file, "Compose file")

    app_env_file = Path(args.app_env_file)
    if not app_env_file.is_absolute():
        app_env_file = repo_root / app_env_file
    app_env_file = ensure_existing_file(app_env_file, "Application env file")

    dockerfile_path = Path(args.dockerfile)
    if not dockerfile_path.is_absolute():
        dockerfile_path = repo_root / dockerfile_path
    dockerfile_path = ensure_existing_file(dockerfile_path, "Dockerfile")

    return compose_file, app_env_file, dockerfile_path


def resolve_project_name(image_name: str, slot_name: str) -> str:
    raw_value = os.getenv("COMPOSE_PROJECT_NAME", "").strip() or f"{image_name}-{slot_name}"
    return sanitize_image_name(raw_value)


def resolve_current_release(project_name: str, state_file: Path) -> dict[str, str] | None:
    running_image = get_service_image(project_name, "api")
    if running_image:
        release = release_from_image(running_image)
        if release:
            return release

    state = load_state(state_file)
    active_release = state.get("active_release")
    if isinstance(active_release, dict):
        return {key: str(value) for key, value in active_release.items()}
    return None


def is_managed_release_image(image_ref: str, image_name: str, tag_suffix: str) -> bool:
    repository, tag = parse_image_reference(image_ref)
    if repository != image_name or not tag:
        return False
    return tag.endswith(f"-{tag_suffix}") or tag.endswith(f"-{tag_suffix}-dirty")


def list_managed_release_images(image_name: str, tag_suffix: str) -> list[tuple[str, datetime]]:
    try:
        output = command_output(["docker", "image", "ls", image_name, "--format", "{{.Repository}}:{{.Tag}}"])
    except subprocess.CalledProcessError:
        return []

    image_refs: list[tuple[str, datetime]] = []
    seen_refs: set[str] = set()
    for raw_line in output.splitlines():
        image_ref = raw_line.strip()
        if not image_ref or image_ref == "<none>:<none>" or image_ref in seen_refs:
            continue
        seen_refs.add(image_ref)
        if not is_managed_release_image(image_ref, image_name, tag_suffix):
            continue

        created_at = datetime.fromtimestamp(0, tz=timezone.utc)
        try:
            created_raw = command_output(["docker", "image", "inspect", image_ref, "--format", "{{.Created}}"])
            created_at = datetime.fromisoformat(created_raw.replace("Z", "+00:00"))
        except (subprocess.CalledProcessError, ValueError):
            print(f"warning: cannot inspect image creation time, fallback to oldest ordering: {image_ref}")

        image_refs.append((image_ref, created_at))

    image_refs.sort(key=lambda item: item[1], reverse=True)
    return image_refs


def collect_running_container_images(image_name: str) -> set[str]:
    try:
        output = command_output(["docker", "ps", "-a", "--format", "{{.Image}}"])
    except subprocess.CalledProcessError:
        return set()

    prefix = f"{image_name}:"
    return {line.strip() for line in output.splitlines() if line.strip().startswith(prefix)}


def collect_preserved_release_images(deploy_root: Path) -> set[str]:
    preserved: set[str] = set()
    if not deploy_root.exists():
        return preserved

    for state_file in deploy_root.glob(f"*/{STATE_FILE_NAME}"):
        try:
            state = load_state(state_file)
        except (OSError, json.JSONDecodeError) as error:
            print(f"warning: failed to read deployment state {state_file}: {error}")
            continue

        for key in ("active_release", "previous_release"):
            release = state.get(key)
            if isinstance(release, dict):
                image_ref = release.get("image")
                if isinstance(image_ref, str) and image_ref.strip():
                    preserved.add(image_ref.strip())

    return preserved


def resolve_keep_releases(args: argparse.Namespace) -> int:
    raw_value = str(args.keep_releases if args.keep_releases is not None else os.getenv("DEPLOY_KEEP_RELEASES", DEFAULT_KEEP_RELEASES))
    try:
        keep_releases = int(raw_value)
    except ValueError as error:
        raise ScriptError(f"Invalid keep release count: {raw_value!r}") from error

    if keep_releases < 0:
        raise ScriptError("--keep-releases cannot be negative.")
    return keep_releases


def resolve_builder_prune_until(args: argparse.Namespace) -> str:
    raw_value = args.builder_prune_until
    if raw_value is None:
        raw_value = os.getenv("DEPLOY_BUILDER_PRUNE_UNTIL", DEFAULT_BUILDER_PRUNE_UNTIL)
    return raw_value.strip()


def cleanup_old_release_images(
    *,
    image_name: str,
    tag_suffix: str,
    deploy_root: Path,
    keep_releases: int,
) -> tuple[list[str], list[str], set[str]]:
    managed_images = list_managed_release_images(image_name, tag_suffix)
    protected_images = collect_preserved_release_images(deploy_root)
    protected_images.update(collect_running_container_images(image_name))
    protected_images.update(image_ref for image_ref, _created_at in managed_images[:keep_releases])

    removed_images: list[str] = []
    failed_images: list[str] = []

    for image_ref, _created_at in managed_images:
        if image_ref in protected_images:
            continue
        try:
            run_command(["docker", "image", "rm", image_ref])
            removed_images.append(image_ref)
        except subprocess.CalledProcessError as error:
            print(f"warning: failed to remove old image {image_ref}: exit code {error.returncode}")
            failed_images.append(image_ref)

    return removed_images, failed_images, protected_images


def prune_builder_cache(until_filter: str) -> bool:
    if not until_filter:
        print("builder prune disabled because no until filter was provided.")
        return False

    try:
        run_command(["docker", "builder", "prune", "-f", "--filter", f"until={until_filter}"])
        return True
    except subprocess.CalledProcessError as error:
        print(f"warning: docker builder prune failed with exit code {error.returncode}")
        return False


def build_compose_env(
    *,
    image_name: str,
    image_tag: str,
    project_name: str,
    app_env_file: Path,
    host_port: str,
    container_port: str,
    bind_ip: str,
    health_path: str,
) -> dict[str, str]:
    return {
        "DEPLOY_IMAGE": image_name,
        "IMAGE_TAG": image_tag,
        "COMPOSE_PROJECT_NAME": project_name,
        "APP_ENV_FILE": str(app_env_file),
        "HOST_BIND_IP": bind_ip,
        "HOST_PORT": host_port,
        "CONTAINER_PORT": container_port,
        "HEALTH_PATH": health_path,
    }


@contextmanager
def deployment_lock(lock_file: Path, timeout_seconds: int):
    lock_file.parent.mkdir(parents=True, exist_ok=True)
    with lock_file.open("a+", encoding="utf-8") as file:
        start = time.monotonic()
        while True:
            try:
                fcntl.flock(file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() - start >= timeout_seconds:
                    raise ScriptError(f"Timed out waiting for deployment lock: {lock_file}")
                time.sleep(1)

        file.seek(0)
        file.truncate()
        file.write(str(os.getpid()))
        file.flush()
        try:
            yield
        finally:
            fcntl.flock(file.fileno(), fcntl.LOCK_UN)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build the current repository locally and roll it out on the same machine with docker compose.",
    )
    parser.add_argument("--branch", help="Git branch to deploy. Defaults to the currently checked out branch.")
    parser.add_argument("--commit", help="Exact commit SHA to deploy. Defaults to the latest commit on the target branch.")
    parser.add_argument(
        "--slot",
        help="Logical deployment slot name, for example online or dev. Used to isolate compose project names and state files.",
    )
    parser.add_argument("--remote", default=DEFAULT_REMOTE, help=f"Git remote used for fetch. Default: {DEFAULT_REMOTE}.")
    parser.add_argument("--env-file", help="Optional deployment env file path. Defaults to <repo>/.env.")
    parser.add_argument(
        "--app-env-file",
        default=DEFAULT_APP_ENV_FILE,
        help=f"Env file injected into the containers. Default: {DEFAULT_APP_ENV_FILE}.",
    )
    parser.add_argument(
        "--compose-file",
        default=DEFAULT_COMPOSE_FILE,
        help=f"Docker compose file path relative to the repository root. Default: {DEFAULT_COMPOSE_FILE}.",
    )
    parser.add_argument(
        "--dockerfile",
        default="Dockerfile",
        help="Dockerfile path relative to the repository root. Default: Dockerfile.",
    )
    parser.add_argument("--image-name", help="Override the local Docker image name. Defaults to DOCKER_IMAGE_NAME or the repo name.")
    parser.add_argument(
        "--version-source",
        choices=("auto", "tag", "commit", "none"),
        default=DEFAULT_VERSION_SOURCE,
        help=f"How to resolve the version part of the image tag. Default: {DEFAULT_VERSION_SOURCE}.",
    )
    parser.add_argument(
        "--tag-suffix",
        default=DEFAULT_TAG_SUFFIX,
        help=f"Suffix appended to the generated image tag. Default: {DEFAULT_TAG_SUFFIX}.",
    )
    parser.add_argument(
        "--skip-git-sync",
        action="store_true",
        help="Do not fetch or reset the repository. Useful for local dry-runs or manual testing.",
    )
    parser.add_argument(
        "--allow-dirty",
        action="store_true",
        help="Allow deploying from a dirty worktree when --skip-git-sync is used.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Resolve the deployment plan without building images or touching running containers.",
    )
    parser.add_argument(
        "--lock-timeout",
        type=int,
        default=DEFAULT_LOCK_TIMEOUT_SECONDS,
        help=f"How long to wait for the deployment lock in seconds. Default: {DEFAULT_LOCK_TIMEOUT_SECONDS}.",
    )
    parser.add_argument(
        "--keep-releases",
        type=int,
        help=f"How many recent local release images to keep. Active and previous releases across all slots are always preserved. Default: DEPLOY_KEEP_RELEASES or {DEFAULT_KEEP_RELEASES}.",
    )
    parser.add_argument(
        "--skip-image-cleanup",
        action="store_true",
        help="Skip removal of older local release images after a successful deployment.",
    )
    parser.add_argument(
        "--builder-prune-until",
        help=f"Age filter passed to docker builder prune, for example 168h. Default: DEPLOY_BUILDER_PRUNE_UNTIL or {DEFAULT_BUILDER_PRUNE_UNTIL}.",
    )
    parser.add_argument(
        "--skip-builder-prune",
        action="store_true",
        help="Skip docker builder prune after a successful deployment.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.dry_run and not args.skip_git_sync:
        raise ScriptError("Use --dry-run together with --skip-git-sync to avoid mutating the deployment checkout.")

    repo_root = resolve_repo_root(Path.cwd())
    image_name = sanitize_image_name(args.image_name or os.getenv("DOCKER_IMAGE_NAME", "").strip() or repo_root.name)
    env_file = find_env_file(repo_root, image_name, args.env_file)
    if env_file:
        load_env_file(env_file)
        print(f"loaded env file: {env_file}")
    else:
        print("env file not found, continuing with the current process environment only.")

    compose_file, app_env_file, dockerfile_path = resolve_runtime_paths(repo_root, args)
    slot_name = sanitize_slot(args.slot or os.getenv("DEPLOY_SLOT", ""))
    project_name = resolve_project_name(image_name, slot_name)
    branch = resolve_branch(repo_root, args.branch)
    keep_releases = resolve_keep_releases(args)
    builder_prune_until = resolve_builder_prune_until(args)
    dirty_checkout = assert_repo_ready_for_sync(repo_root, skip_git_sync=args.skip_git_sync, allow_dirty=args.allow_dirty)

    deploy_root = repo_root / STATE_DIR_NAME
    state_dir = deploy_root / slot_name
    state_file = state_dir / STATE_FILE_NAME
    lock_file = deploy_root / LOCK_FILE_NAME
    compose_env_file = state_dir / COMPOSE_ENV_FILE_NAME

    with deployment_lock(lock_file, args.lock_timeout):
        if not args.skip_git_sync:
            sync_checkout(repo_root, args.remote, branch, args.commit)

        commit_sha = git_output(repo_root, "rev-parse", "HEAD")
        short_sha = git_output(repo_root, "rev-parse", "--short=6", "HEAD")
        version, version_source = resolve_version(repo_root, args.version_source)

        image_tag = build_image_tag(branch, short_sha, args.tag_suffix, version)
        if dirty_checkout:
            image_tag = f"{image_tag}-dirty"
            print("warning: repository has uncommitted changes, tagging image as dirty.")

        image_full_name = f"{image_name}:{image_tag}"
        previous_release = resolve_current_release(project_name, state_file)

        bind_ip = os.getenv("DEPLOY_HOST_BIND_IP", DEFAULT_BIND_IP).strip() or DEFAULT_BIND_IP
        host_port = os.getenv("DEPLOY_HOST_PORT", os.getenv("PORT", DEFAULT_PORT)).strip() or DEFAULT_PORT
        container_port = os.getenv("DEPLOY_CONTAINER_PORT", os.getenv("PORT", DEFAULT_PORT)).strip() or DEFAULT_PORT
        health_path = normalize_health_path(os.getenv("HEALTH_PATH", DEFAULT_HEALTH_PATH))

        print(f"use repo root: {repo_root}")
        print(f"use slot: {slot_name}")
        print(f"use branch: {branch}")
        print(f"use commit: {commit_sha}")
        print(f"use image: {image_full_name}")
        print(f"keep recent release images: {keep_releases}")
        if version:
            print(f"use version: {version} ({version_source})")
        else:
            print("version not found from Git tag or commit message, fallback to branch + shortsha.")
        if previous_release:
            print(f"current running release: {previous_release['image']}")
        else:
            print("current running release: none")

        compose_env = build_compose_env(
            image_name=image_name,
            image_tag=image_tag,
            project_name=project_name,
            app_env_file=app_env_file,
            host_port=host_port,
            container_port=container_port,
            bind_ip=bind_ip,
            health_path=health_path,
        )

        if args.dry_run:
            print("dry-run enabled, skip git-changing operations after planning, docker build, and docker compose up.")
            print(json.dumps(compose_env, indent=2, ensure_ascii=True))
            return 0

        build_start = get_time()
        print("===== START BUILD LOCAL IMAGE =====")
        build_local_image(repo_root, dockerfile_path, image_full_name, image_name, image_tag, commit_sha)
        print(f"===== END BUILD LOCAL IMAGE cost: {print_time(get_time() - build_start)} =====")

        write_compose_env(compose_env_file, compose_env)

        deploy_start = get_time()
        print("===== START DEPLOY LOCAL RELEASE =====")
        deploy_release(repo_root, project_name, compose_file, compose_env_file)

        if wait_for_release(project_name, bind_ip, host_port, health_path):
            write_state(
                state_file,
                {
                    "active_release": {
                        "image": image_full_name,
                        "image_name": image_name,
                        "image_tag": image_tag,
                        "branch": branch,
                        "commit": commit_sha,
                        "version": version or "",
                        "version_source": version_source or "",
                        "deployed_at": now_iso(),
                    },
                    "previous_release": previous_release or {},
                },
            )

            cleanup_start = get_time()
            if args.skip_image_cleanup:
                print("skip image cleanup by flag.")
            else:
                removed_images, failed_images, protected_images = cleanup_old_release_images(
                    image_name=image_name,
                    tag_suffix=args.tag_suffix,
                    deploy_root=deploy_root,
                    keep_releases=keep_releases,
                )
                print(f"protected release images: {len(protected_images)}")
                if removed_images:
                    print("removed old release images:")
                    for image_ref in removed_images:
                        print(f"  - {image_ref}")
                else:
                    print("no old release images needed removal.")
                if failed_images:
                    print("warning: some old release images could not be removed:")
                    for image_ref in failed_images:
                        print(f"  - {image_ref}")

            if args.skip_builder_prune:
                print("skip builder prune by flag.")
            else:
                prune_builder_cache(builder_prune_until)
            print(f"===== END CLEANUP cost: {print_time(get_time() - cleanup_start)} =====")

            print(f"===== END DEPLOY LOCAL RELEASE cost: {print_time(get_time() - deploy_start)} =====")
            print("===== LOCAL DEPLOY SUCCESS =====")
            return 0

        print("deployment health check failed, collecting logs...")
        logs = collect_compose_logs(project_name, compose_file, compose_env_file)
        if logs:
            print("===== COMPOSE LOGS =====")
            print(logs)

        if previous_release:
            previous_compose_env = build_compose_env(
                image_name=previous_release["image_name"],
                image_tag=previous_release["image_tag"],
                project_name=project_name,
                app_env_file=app_env_file,
                host_port=host_port,
                container_port=container_port,
                bind_ip=bind_ip,
                health_path=health_path,
            )
            print(f"attempt rollback to: {previous_release['image']}")
            write_compose_env(compose_env_file, previous_compose_env)
            deploy_release(repo_root, project_name, compose_file, compose_env_file)
            rollback_ok = wait_for_release(project_name, bind_ip, host_port, health_path)
            if rollback_ok:
                write_state(
                    state_file,
                    {
                        "active_release": previous_release,
                        "previous_release": {},
                    },
                )
                print("rollback succeeded.")
            else:
                print("rollback failed.")
        else:
            print("no previous release found, skip rollback.")

        print(f"===== END DEPLOY LOCAL RELEASE cost: {print_time(get_time() - deploy_start)} =====")
        return 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("deployment interrupted by user", file=sys.stderr)
        raise SystemExit(130)
    except subprocess.CalledProcessError as error:
        print(f"command failed with exit code {error.returncode}: {format_command(error.cmd)}", file=sys.stderr)
        if error.stdout:
            print(error.stdout, file=sys.stderr, end="" if error.stdout.endswith("\n") else "\n")
        if error.stderr:
            print(error.stderr, file=sys.stderr, end="" if error.stderr.endswith("\n") else "\n")
        raise SystemExit(error.returncode)
    except ScriptError as error:
        print(error, file=sys.stderr)
        raise SystemExit(1)
