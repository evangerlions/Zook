#!/usr/bin/env python3.14
"""Shared helpers for the PostgreSQL and Redis dual-environment setup scripts."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import os
import secrets
import shlex
import shutil
import subprocess
import time


class SetupError(RuntimeError):
    """Raised when a setup step cannot be completed safely."""


@dataclass(slots=True)
class StepLogger:
    """Prints consistent, step-oriented logs so long-running tasks feel observable."""

    script_name: str
    step_index: int = 0

    def _emit(self, level: str, message: str) -> None:
        timestamp = time.strftime("%H:%M:%S")
        print(f"[{timestamp}][{self.script_name}][{level}] {message}", flush=True)

    def step(self, message: str) -> None:
        """Marks a new major setup phase."""
        self.step_index += 1
        self._emit(f"step {self.step_index}", message)

    def info(self, message: str) -> None:
        """Logs supporting information for the current step."""
        self._emit("info", message)

    def success(self, message: str) -> None:
        """Logs a successful milestone."""
        self._emit("done", message)

    def warn(self, message: str) -> None:
        """Logs a non-fatal condition that may still matter to the operator."""
        self._emit("warn", message)

    def command(self, command: list[str]) -> None:
        """Shows the exact command being executed without exposing stdin content."""
        self._emit("cmd", shlex.join(command))


def require_command(name: str) -> None:
    """Fails fast when a required binary is missing from PATH."""
    if shutil.which(name) is None:
        raise SetupError(f"Missing command: {name}")


def run_command(
    command: list[str],
    *,
    logger: StepLogger,
    check: bool = True,
    capture_output: bool = False,
    input_text: str | None = None,
    env: dict[str, str] | None = None,
    cwd: Path | None = None,
) -> subprocess.CompletedProcess[str]:
    """Runs a subprocess and raises a readable error if it fails."""
    logger.command(command)
    try:
        completed = subprocess.run(
            command,
            check=False,
            capture_output=capture_output,
            cwd=cwd,
            env=env,
            input=input_text,
            text=True,
        )
    except FileNotFoundError as exc:
        raise SetupError(f"Missing command: {command[0]}") from exc

    if check and completed.returncode != 0:
        stderr = (completed.stderr or "").strip()
        stdout = (completed.stdout or "").strip()
        details = stderr or stdout or f"exit code {completed.returncode}"
        raise SetupError(f"Command failed: {shlex.join(command)}\n{details}")

    return completed


def run_capture(
    command: list[str],
    *,
    logger: StepLogger,
    env: dict[str, str] | None = None,
    cwd: Path | None = None,
    input_text: str | None = None,
) -> str:
    """Runs a command and returns trimmed stdout."""
    completed = run_command(
        command,
        logger=logger,
        capture_output=True,
        env=env,
        cwd=cwd,
        input_text=input_text,
    )
    return completed.stdout.strip()


def generate_secret(length: int = 32) -> str:
    """Generates an alphanumeric password that is easy to place into env files."""
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def read_saved_value(key: str, file_path: Path) -> str | None:
    """Loads a previously generated value from an env-style file when it exists."""
    if not file_path.is_file():
        return None

    for line in file_path.read_text(encoding="utf-8").splitlines():
        if "=" not in line:
            continue
        current_key, value = line.split("=", 1)
        if current_key == key:
            return value
    return None


def path_is_writable(path: Path) -> bool:
    """Checks whether we can write to a file or, if absent, to its parent directory."""
    # Avoid Path.exists() here because protected system paths like /etc/redis may
    # raise PermissionError before we get a chance to fall back to sudo.
    if os.access(path, os.F_OK):
        return os.access(path, os.W_OK)
    return os.access(path.parent, os.W_OK)


def read_text_with_optional_sudo(path: Path, *, sudo_prefix: list[str], logger: StepLogger) -> str:
    """Reads root-owned files via sudo when direct filesystem access is not enough."""
    if os.access(path, os.R_OK):
        return path.read_text(encoding="utf-8")

    if not sudo_prefix:
        raise SetupError(f"Cannot read file: {path}")

    return run_capture([*sudo_prefix, "cat", str(path)], logger=logger)


def write_text_with_optional_sudo(
    path: Path,
    content: str,
    *,
    sudo_prefix: list[str],
    logger: StepLogger,
) -> None:
    """Writes root-owned files via sudo tee while keeping file contents out of logs."""
    if path_is_writable(path):
        try:
            path.write_text(content, encoding="utf-8")
            return
        except PermissionError:
            # Some system locations can still reject the write even when access
            # checks look permissive, so we fall through to the sudo path.
            pass

    if not sudo_prefix:
        raise SetupError(f"Cannot write file without sudo privileges: {path}")

    run_command(
        [*sudo_prefix, "tee", str(path)],
        logger=logger,
        capture_output=True,
        input_text=content,
    )


def ensure_directory(path: Path, *, sudo_prefix: list[str], logger: StepLogger) -> None:
    """Creates directories with sudo when the target path is system-owned."""
    if os.access(path, os.F_OK):
        return

    if path_is_writable(path):
        path.mkdir(parents=True, exist_ok=True)
        return

    if not sudo_prefix:
        raise SetupError(f"Cannot create directory without sudo privileges: {path}")

    run_command([*sudo_prefix, "mkdir", "-p", str(path)], logger=logger)


def build_sudo_prefix(system_name: str) -> list[str]:
    """Uses sudo on Linux when the script is not already running as root."""
    if system_name == "Linux" and os.geteuid() != 0:
        require_command("sudo")
        return ["sudo"]
    return []


def write_env_file(path: Path, values: dict[str, str]) -> None:
    """Persists generated connection settings in a simple KEY=VALUE format."""
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [f"{key}={value}" for key, value in values.items()]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
