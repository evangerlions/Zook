#!/usr/bin/env python3.14
"""Install and configure two Redis instances for dev + online on the same host."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
import os
import platform
import time

from setup_common import (
    SetupError,
    StepLogger,
    build_sudo_prefix,
    ensure_directory,
    generate_secret,
    read_saved_value,
    require_command,
    run_capture,
    run_command,
    write_env_file,
    write_text_with_optional_sudo,
)


@dataclass(slots=True)
class RedisConfig:
    """Holds all Redis settings that can be overridden from the environment."""

    project_name: str
    redis_host: str
    redis_bind: str
    online_port: int
    dev_port: int
    online_maxmemory: str
    online_maxmemory_policy: str
    dev_maxmemory: str
    dev_maxmemory_policy: str
    online_cache_prefix: str
    online_bullmq_prefix: str
    dev_cache_prefix: str
    dev_bullmq_prefix: str
    repo_root: Path


class RedisDualEnvSetup:
    """Configures two isolated Redis instances with different resource profiles."""

    def __init__(self, config: RedisConfig) -> None:
        self.config = config
        self.logger = StepLogger("redis-dual")
        self.system_name = platform.system()
        self.sudo_prefix = build_sudo_prefix(self.system_name)
        self.generated_root = self.config.repo_root / "db_doc" / "generated"
        self.dev_env_file = self.generated_root / "dev" / "redis.env"
        self.online_env_file = self.generated_root / "online" / "redis.env"
        self.redis_server_bin = ""
        self.redis_cli_bin = ""
        self.mac_prefix: Path | None = None
        self.mac_etc_dir: Path | None = None
        self.mac_var_dir: Path | None = None
        self.online_password = ""
        self.dev_password = ""
        self.validate_config()

    def validate_config(self) -> None:
        """Catches obviously broken ports before package installation starts."""
        for port in (self.config.online_port, self.config.dev_port):
            if not (1 <= port <= 65535):
                raise SetupError(f"Invalid Redis port: {port}")

    def run(self) -> None:
        """Runs the entire Redis provisioning flow in a logged sequence."""
        self.load_passwords()
        self.install_redis()
        self.configure_instances()
        self.write_env_files()
        self.verify_connections()
        self.logger.success("Redis dual-environment setup completed")
        self.logger.info(f"Online env file: {self.online_env_file}")
        self.logger.info(f"Dev env file: {self.dev_env_file}")

    def load_passwords(self) -> None:
        """Reuses existing passwords so rerunning the script keeps URLs stable."""
        self.logger.step("Loading or generating Redis passwords")
        self.online_password = os.environ.get(
            "ONLINE_REDIS_PASSWORD",
            read_saved_value("REDIS_PASSWORD", self.online_env_file) or generate_secret(),
        )
        self.dev_password = os.environ.get(
            "DEV_REDIS_PASSWORD",
            read_saved_value("REDIS_PASSWORD", self.dev_env_file) or generate_secret(),
        )
        self.logger.success("Redis passwords are ready")

    def install_redis(self) -> None:
        """Installs Redis and discovers the platform-specific binary locations."""
        self.logger.step("Installing Redis and preparing service metadata")
        if self.system_name == "Darwin":
            self.install_redis_macos()
        elif self.system_name == "Linux":
            self.install_redis_linux()
        else:
            raise SetupError(f"Unsupported operating system: {self.system_name}")
        self.logger.success("Redis binaries and service paths are ready")

    def install_redis_macos(self) -> None:
        """Uses Homebrew and prepares writable config/data directories on macOS."""
        require_command("brew")
        result = run_command(["brew", "list", "redis"], logger=self.logger, check=False, capture_output=True)
        if result.returncode != 0:
            self.logger.info("Homebrew formula redis is not installed yet; installing now")
            run_command(["brew", "install", "redis"], logger=self.logger)

        self.mac_prefix = Path(run_capture(["brew", "--prefix"], logger=self.logger))
        self.redis_server_bin = str(self.mac_prefix / "bin" / "redis-server")
        self.redis_cli_bin = str(self.mac_prefix / "bin" / "redis-cli")
        self.mac_etc_dir = self.mac_prefix / "etc"
        self.mac_var_dir = self.mac_prefix / "var"
        ensure_directory(self.mac_var_dir / "log", sudo_prefix=self.sudo_prefix, logger=self.logger)

    def install_redis_linux(self) -> None:
        """Installs Redis packages and disables the default singleton service."""
        require_command("apt-get")
        run_command([*self.sudo_prefix, "apt-get", "update"], logger=self.logger)
        run_command([*self.sudo_prefix, "apt-get", "install", "-y", "redis-server"], logger=self.logger)
        self.redis_server_bin = "/usr/bin/redis-server"
        self.redis_cli_bin = "/usr/bin/redis-cli"

        self.logger.info("Disabling default Redis services to avoid port conflicts")
        run_command(
            [*self.sudo_prefix, "systemctl", "disable", "--now", "redis-server"],
            logger=self.logger,
            check=False,
        )
        run_command(
            [*self.sudo_prefix, "systemctl", "disable", "--now", "redis"],
            logger=self.logger,
            check=False,
        )

    def configure_instances(self) -> None:
        """Creates one stable instance for online and one lighter instance for dev."""
        self.logger.step("Configuring Redis instances")
        if self.system_name == "Darwin":
            self.setup_macos_instance(
                env_name="online",
                port=self.config.online_port,
                password=self.online_password,
                appendonly="yes",
                maxmemory=self.config.online_maxmemory,
                maxmemory_policy=self.config.online_maxmemory_policy,
            )
            self.setup_macos_instance(
                env_name="dev",
                port=self.config.dev_port,
                password=self.dev_password,
                appendonly="no",
                maxmemory=self.config.dev_maxmemory,
                maxmemory_policy=self.config.dev_maxmemory_policy,
            )
        else:
            self.setup_linux_instance(
                env_name="online",
                port=self.config.online_port,
                password=self.online_password,
                appendonly="yes",
                maxmemory=self.config.online_maxmemory,
                maxmemory_policy=self.config.online_maxmemory_policy,
            )
            self.setup_linux_instance(
                env_name="dev",
                port=self.config.dev_port,
                password=self.dev_password,
                appendonly="no",
                maxmemory=self.config.dev_maxmemory,
                maxmemory_policy=self.config.dev_maxmemory_policy,
            )
        self.logger.success("Redis instances configured")

    def setup_linux_instance(
        self,
        *,
        env_name: str,
        port: int,
        password: str,
        appendonly: str,
        maxmemory: str,
        maxmemory_policy: str,
    ) -> None:
        """Creates Linux config files, data dirs, and a dedicated systemd service."""
        self.logger.info(f"Preparing Linux Redis instance for {env_name}")
        conf_file = Path(f"/etc/redis/{self.config.project_name}-{env_name}.conf")
        data_dir = Path(f"/var/lib/redis-{self.config.project_name}-{env_name}")
        service_name = f"redis-{self.config.project_name}-{env_name}.service"
        service_file = Path("/etc/systemd/system") / service_name

        ensure_directory(data_dir, sudo_prefix=self.sudo_prefix, logger=self.logger)
        ensure_directory(Path("/var/log/redis"), sudo_prefix=self.sudo_prefix, logger=self.logger)
        run_command(
            [*self.sudo_prefix, "chown", "-R", "redis:redis", str(data_dir), "/var/log/redis"],
            logger=self.logger,
        )

        write_text_with_optional_sudo(
            conf_file,
            self.build_linux_redis_conf(
                env_name=env_name,
                port=port,
                password=password,
                appendonly=appendonly,
                data_dir=data_dir,
                maxmemory=maxmemory,
                maxmemory_policy=maxmemory_policy,
            ),
            sudo_prefix=self.sudo_prefix,
            logger=self.logger,
        )
        write_text_with_optional_sudo(
            service_file,
            self.build_linux_systemd_service(service_name=service_name, conf_file=conf_file),
            sudo_prefix=self.sudo_prefix,
            logger=self.logger,
        )
        run_command([*self.sudo_prefix, "systemctl", "daemon-reload"], logger=self.logger)
        self.enable_and_start_linux_service(service_name)

    def setup_macos_instance(
        self,
        *,
        env_name: str,
        port: int,
        password: str,
        appendonly: str,
        maxmemory: str,
        maxmemory_policy: str,
    ) -> None:
        """Creates macOS config files and LaunchAgents for automatic restarts."""
        self.logger.info(f"Preparing macOS Redis instance for {env_name}")
        if self.mac_etc_dir is None or self.mac_var_dir is None:
            raise SetupError("Redis macOS directories are not initialized")

        conf_file = self.mac_etc_dir / f"{self.config.project_name}-{env_name}.redis.conf"
        data_dir = self.mac_var_dir / f"{self.config.project_name}-redis-{env_name}"
        launch_agent_dir = Path.home() / "Library" / "LaunchAgents"
        label = f"com.{self.config.project_name}.redis.{env_name}"
        plist_file = launch_agent_dir / f"{label}.plist"
        log_file = self.mac_var_dir / "log" / f"{self.config.project_name}-{env_name}.launchd.log"

        ensure_directory(data_dir, sudo_prefix=self.sudo_prefix, logger=self.logger)
        ensure_directory(launch_agent_dir, sudo_prefix=self.sudo_prefix, logger=self.logger)

        conf_file.write_text(
            self.build_macos_redis_conf(
                env_name=env_name,
                port=port,
                password=password,
                appendonly=appendonly,
                data_dir=data_dir,
                maxmemory=maxmemory,
                maxmemory_policy=maxmemory_policy,
            ),
            encoding="utf-8",
        )
        plist_file.write_text(
            self.build_macos_launch_agent(label=label, conf_file=conf_file, log_file=log_file),
            encoding="utf-8",
        )

        run_command(
            ["launchctl", "bootout", f"gui/{os.getuid()}", str(plist_file)],
            logger=self.logger,
            check=False,
        )
        run_command(["launchctl", "bootstrap", f"gui/{os.getuid()}", str(plist_file)], logger=self.logger)

    def write_env_files(self) -> None:
        """Stores the generated connection details for both environments."""
        self.logger.step("Writing generated Redis env files")
        write_env_file(
            self.online_env_file,
            {
                "REDIS_ENV": "online",
                "REDIS_HOST": self.config.redis_host,
                "REDIS_PORT": str(self.config.online_port),
                "REDIS_DATABASE": "0",
                "REDIS_PASSWORD": self.online_password,
                "REDIS_URL": f"redis://:{self.online_password}@{self.config.redis_host}:{self.config.online_port}/0",
                "REDIS_MAXMEMORY": self.config.online_maxmemory,
                "REDIS_MAXMEMORY_POLICY": self.config.online_maxmemory_policy,
                "CACHE_PREFIX": self.config.online_cache_prefix,
                "BULLMQ_PREFIX": self.config.online_bullmq_prefix,
                "REDIS_CACHE_TTL_SECONDS": "30",
            },
        )
        write_env_file(
            self.dev_env_file,
            {
                "REDIS_ENV": "dev",
                "REDIS_HOST": self.config.redis_host,
                "REDIS_PORT": str(self.config.dev_port),
                "REDIS_DATABASE": "0",
                "REDIS_PASSWORD": self.dev_password,
                "REDIS_URL": f"redis://:{self.dev_password}@{self.config.redis_host}:{self.config.dev_port}/0",
                "REDIS_MAXMEMORY": self.config.dev_maxmemory,
                "REDIS_MAXMEMORY_POLICY": self.config.dev_maxmemory_policy,
                "CACHE_PREFIX": self.config.dev_cache_prefix,
                "BULLMQ_PREFIX": self.config.dev_bullmq_prefix,
                "REDIS_CACHE_TTL_SECONDS": "30",
            },
        )
        self.logger.success("Generated Redis env files written")

    def verify_connections(self) -> None:
        """Retries pings briefly so service boot timing does not look like a silent hang."""
        self.logger.step("Verifying Redis runtime connections")
        connection_specs = [
            ("online", self.config.online_port, self.online_password),
            ("dev", self.config.dev_port, self.dev_password),
        ]

        for env_name, port, password in connection_specs:
            self.logger.info(f"Checking Redis ping for {env_name} on port {port}")
            env = os.environ.copy()
            env["REDISCLI_AUTH"] = password
            for attempt in range(1, 6):
                result = run_command(
                    [self.redis_cli_bin, "-h", self.config.redis_host, "-p", str(port), "ping"],
                    logger=self.logger,
                    env=env,
                    capture_output=True,
                    check=False,
                )
                if result.returncode == 0 and "PONG" in result.stdout:
                    break
                self.logger.warn(f"Redis {env_name} is not ready yet, retrying ({attempt}/5)")
                time.sleep(1)
            else:
                raise SetupError(f"Redis instance on port {port} did not become ready")

        self.logger.success("Redis runtime connections verified")

    def build_linux_redis_conf(
        self,
        *,
        env_name: str,
        port: int,
        password: str,
        appendonly: str,
        data_dir: Path,
        maxmemory: str,
        maxmemory_policy: str,
    ) -> str:
        """Renders the Linux Redis config file with environment-specific memory policy."""
        runtime_dir = f"/run/redis-{self.config.project_name}-{env_name}"
        return f"""bind {self.config.redis_bind}
protected-mode yes
port {port}
tcp-backlog 511
timeout 0
tcp-keepalive 60
daemonize no
supervised systemd
pidfile {runtime_dir}/redis.pid
loglevel notice
logfile /var/log/redis/{self.config.project_name}-{env_name}.log
databases 1
always-show-logo no
save 900 1
save 300 10
save 60 10000
stop-writes-on-bgsave-error yes
rdbcompression yes
rdbchecksum yes
dbfilename dump-{self.config.project_name}-{env_name}.rdb
dir {data_dir}
requirepass {password}
appendonly {appendonly}
appendfilename appendonly-{self.config.project_name}-{env_name}.aof
appendfsync everysec
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
maxmemory {maxmemory}
maxmemory-policy {maxmemory_policy}
"""

    def build_macos_redis_conf(
        self,
        *,
        env_name: str,
        port: int,
        password: str,
        appendonly: str,
        data_dir: Path,
        maxmemory: str,
        maxmemory_policy: str,
    ) -> str:
        """Renders the macOS Redis config file using Homebrew-managed paths."""
        if self.mac_prefix is None:
            raise SetupError("Redis Homebrew prefix is not initialized")

        return f"""bind {self.config.redis_bind}
protected-mode yes
port {port}
timeout 0
tcp-keepalive 60
daemonize no
loglevel notice
logfile {self.mac_prefix}/var/log/{self.config.project_name}-{env_name}.log
databases 1
always-show-logo no
save 900 1
save 300 10
save 60 10000
stop-writes-on-bgsave-error yes
rdbcompression yes
rdbchecksum yes
dbfilename dump-{self.config.project_name}-{env_name}.rdb
dir {data_dir}
requirepass {password}
appendonly {appendonly}
appendfilename appendonly-{self.config.project_name}-{env_name}.aof
appendfsync everysec
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
maxmemory {maxmemory}
maxmemory-policy {maxmemory_policy}
"""

    def build_linux_systemd_service(self, *, service_name: str, conf_file: Path) -> str:
        """Creates a dedicated systemd service per Redis instance."""
        runtime_directory = service_name.removesuffix(".service")
        return f"""[Unit]
Description=Redis instance for {self.config.project_name}
After=network.target

[Service]
Type=notify
User=redis
Group=redis
RuntimeDirectory={runtime_directory}
RuntimeDirectoryMode=2755
UMask=007
ExecStart={self.redis_server_bin} {conf_file} --supervised systemd --daemonize no
ExecStop=/bin/kill -s TERM $MAINPID
Restart=always
RestartSec=2
LimitNOFILE=10032

[Install]
WantedBy=multi-user.target
"""

    def enable_and_start_linux_service(self, service_name: str) -> None:
        """Starts a service and includes status snippets when systemd rejects it."""
        result = run_command(
            [*self.sudo_prefix, "systemctl", "enable", "--now", service_name],
            logger=self.logger,
            check=False,
            capture_output=True,
        )
        if result.returncode == 0:
            return

        self.logger.warn(f"systemd failed to start {service_name}; collecting diagnostics")
        status_output = run_command(
            [*self.sudo_prefix, "systemctl", "status", service_name, "--no-pager", "-l"],
            logger=self.logger,
            check=False,
            capture_output=True,
        )
        if status_output.stdout.strip():
            self.logger.warn(status_output.stdout.strip())
        elif status_output.stderr.strip():
            self.logger.warn(status_output.stderr.strip())

        journal_output = run_command(
            [*self.sudo_prefix, "journalctl", "-u", service_name, "-n", "40", "--no-pager"],
            logger=self.logger,
            check=False,
            capture_output=True,
        )
        if journal_output.stdout.strip():
            self.logger.warn(journal_output.stdout.strip())
        elif journal_output.stderr.strip():
            self.logger.warn(journal_output.stderr.strip())

        stderr = (result.stderr or "").strip()
        stdout = (result.stdout or "").strip()
        details = stderr or stdout or f"exit code {result.returncode}"
        raise SetupError(f"Command failed: {' '.join([*self.sudo_prefix, 'systemctl', 'enable', '--now', service_name])}\n{details}")

    def build_macos_launch_agent(self, *, label: str, conf_file: Path, log_file: Path) -> str:
        """Creates a LaunchAgent so Redis restarts after macOS login."""
        return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{self.redis_server_bin}</string>
    <string>{conf_file}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>{log_file}</string>
  <key>StandardErrorPath</key>
  <string>{log_file}</string>
</dict>
</plist>
"""


def build_config() -> RedisConfig:
    """Loads environment overrides while keeping the single-host defaults simple."""
    repo_root = Path(__file__).resolve().parents[2]
    project_name = os.environ.get("PROJECT_NAME", "zook")
    return RedisConfig(
        project_name=project_name,
        redis_host=os.environ.get("REDIS_HOST", "127.0.0.1"),
        redis_bind=os.environ.get("REDIS_BIND", "127.0.0.1 ::1"),
        online_port=int(os.environ.get("ONLINE_REDIS_PORT", "6379")),
        dev_port=int(os.environ.get("DEV_REDIS_PORT", "6380")),
        online_maxmemory=os.environ.get("ONLINE_REDIS_MAXMEMORY", "0"),
        online_maxmemory_policy=os.environ.get("ONLINE_REDIS_MAXMEMORY_POLICY", "noeviction"),
        dev_maxmemory=os.environ.get("DEV_REDIS_MAXMEMORY", "128mb"),
        dev_maxmemory_policy=os.environ.get("DEV_REDIS_MAXMEMORY_POLICY", "allkeys-lru"),
        online_cache_prefix=os.environ.get("ONLINE_CACHE_PREFIX", f"{project_name}:online:cache"),
        online_bullmq_prefix=os.environ.get("ONLINE_BULLMQ_PREFIX", f"{project_name}:online:bull"),
        dev_cache_prefix=os.environ.get("DEV_CACHE_PREFIX", f"{project_name}:dev:cache"),
        dev_bullmq_prefix=os.environ.get("DEV_BULLMQ_PREFIX", f"{project_name}:dev:bull"),
        repo_root=repo_root,
    )


def parse_args() -> argparse.Namespace:
    """Documents the supported environment overrides without adding complex flags."""
    parser = argparse.ArgumentParser(
        description="Install and configure Redis online + dev instances on the same host.",
        epilog=(
            "Environment overrides: PROJECT_NAME, REDIS_HOST, REDIS_BIND, ONLINE_REDIS_PORT, "
            "DEV_REDIS_PORT, ONLINE_REDIS_PASSWORD, DEV_REDIS_PASSWORD, "
            "ONLINE_REDIS_MAXMEMORY, ONLINE_REDIS_MAXMEMORY_POLICY, DEV_REDIS_MAXMEMORY, "
            "DEV_REDIS_MAXMEMORY_POLICY, ONLINE_CACHE_PREFIX, ONLINE_BULLMQ_PREFIX, "
            "DEV_CACHE_PREFIX, DEV_BULLMQ_PREFIX"
        ),
    )
    return parser.parse_args()


def main() -> int:
    """Parses args, runs the setup, and exits with a clean non-zero code on failure."""
    parse_args()
    try:
        RedisDualEnvSetup(build_config()).run()
    except SetupError as exc:
        print(f"[redis-dual][error] {exc}", file=os.sys.stderr, flush=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
