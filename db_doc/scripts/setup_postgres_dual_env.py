#!/usr/bin/env python3.14
"""Install and configure one PostgreSQL instance for dev + online on the same host."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
import os
import platform
import re
import shutil
import sys

from setup_common import (
    SetupError,
    StepLogger,
    build_sudo_prefix,
    ensure_directory,
    generate_secret,
    read_saved_value,
    read_text_with_optional_sudo,
    require_command,
    run_capture,
    run_command,
    write_env_file,
    write_text_with_optional_sudo,
)


MANAGED_BLOCK_START = "# BEGIN ZOOK DUAL ENV MANAGED BLOCK"
MANAGED_BLOCK_END = "# END ZOOK DUAL ENV MANAGED BLOCK"
IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


@dataclass(slots=True)
class PostgresConfig:
    """Collects all environment-driven configuration in one place."""

    project_name: str
    pg_port: int
    pg_host: str
    pg_listen_addresses: str
    pg_brew_formula: str
    dev_db_name: str
    online_db_name: str
    dev_app_role: str
    dev_migrator_role: str
    online_app_role: str
    online_migrator_role: str
    repo_root: Path


class PostgresDualEnvSetup:
    """Coordinates install, config, role creation, and connection file generation."""

    def __init__(self, config: PostgresConfig) -> None:
        self.config = config
        self.logger = StepLogger("postgres-dual")
        self.system_name = platform.system()
        self.sudo_prefix = build_sudo_prefix(self.system_name)
        self.generated_root = self.config.repo_root / "db_doc" / "generated"
        self.dev_env_file = self.generated_root / "dev" / "postgres.env"
        self.online_env_file = self.generated_root / "online" / "postgres.env"
        self.pg_conf_file: Path | None = None
        self.pg_hba_file: Path | None = None
        self.pg_service_name: str | None = None
        self.pg_bin_dir: Path | None = None
        self.psql_bin: str | None = None
        self.dev_app_password = ""
        self.dev_migrator_password = ""
        self.online_app_password = ""
        self.online_migrator_password = ""
        self.validate_config()

    def validate_config(self) -> None:
        """Rejects unsafe database identifiers early so SQL generation stays predictable."""
        for name in (
            self.config.dev_db_name,
            self.config.online_db_name,
            self.config.dev_app_role,
            self.config.dev_migrator_role,
            self.config.online_app_role,
            self.config.online_migrator_role,
        ):
            if not IDENTIFIER_PATTERN.fullmatch(name):
                raise SetupError(f"Invalid PostgreSQL identifier: {name}")

        if not (1 <= self.config.pg_port <= 65535):
            raise SetupError(f"Invalid PG_PORT: {self.config.pg_port}")

    def run(self) -> None:
        """Executes the full setup flow in a predictable, logged order."""
        self.load_passwords()
        self.install_postgresql()
        self.configure_postgresql_conf()
        self.configure_pg_hba()
        self.restart_postgresql()
        self.create_roles()
        self.create_databases()
        self.configure_privileges()
        self.write_env_files()
        self.verify_connections()
        self.logger.success("PostgreSQL dual-environment setup completed")
        self.logger.info(f"Dev env file: {self.dev_env_file}")
        self.logger.info(f"Online env file: {self.online_env_file}")

    def load_passwords(self) -> None:
        """Reuses generated passwords when available so reruns stay idempotent."""
        self.logger.step("Loading or generating PostgreSQL credentials")
        self.dev_app_password = os.environ.get(
            "DEV_APP_PASSWORD",
            read_saved_value("PG_APP_PASSWORD", self.dev_env_file) or generate_secret(),
        )
        self.dev_migrator_password = os.environ.get(
            "DEV_MIGRATOR_PASSWORD",
            read_saved_value("PG_MIGRATOR_PASSWORD", self.dev_env_file) or generate_secret(),
        )
        self.online_app_password = os.environ.get(
            "ONLINE_APP_PASSWORD",
            read_saved_value("PG_APP_PASSWORD", self.online_env_file) or generate_secret(),
        )
        self.online_migrator_password = os.environ.get(
            "ONLINE_MIGRATOR_PASSWORD",
            read_saved_value("PG_MIGRATOR_PASSWORD", self.online_env_file) or generate_secret(),
        )
        self.logger.success("PostgreSQL credentials are ready")

    def install_postgresql(self) -> None:
        """Installs PostgreSQL and discovers platform-specific paths."""
        self.logger.step("Installing and starting PostgreSQL")
        if self.system_name == "Darwin":
            self.install_postgresql_macos()
        elif self.system_name == "Linux":
            self.install_postgresql_linux()
        else:
            raise SetupError(f"Unsupported operating system: {self.system_name}")
        self.logger.success("PostgreSQL is installed and service metadata is loaded")

    def install_postgresql_macos(self) -> None:
        """Uses Homebrew on macOS and initializes the data directory when needed."""
        require_command("brew")
        formula = self.config.pg_brew_formula
        result = run_command(["brew", "list", formula], logger=self.logger, check=False, capture_output=True)
        if result.returncode != 0:
            self.logger.info(f"Homebrew formula {formula} is not installed yet; installing now")
            run_command(["brew", "install", formula], logger=self.logger)

        brew_prefix = Path(run_capture(["brew", "--prefix"], logger=self.logger))
        formula_prefix = Path(run_capture(["brew", "--prefix", formula], logger=self.logger))
        self.pg_bin_dir = formula_prefix / "bin"
        self.psql_bin = str(self.pg_bin_dir / "psql")
        pg_data_dir = brew_prefix / "var" / formula
        ensure_directory(pg_data_dir, sudo_prefix=self.sudo_prefix, logger=self.logger)
        self.pg_conf_file = pg_data_dir / "postgresql.conf"
        self.pg_hba_file = pg_data_dir / "pg_hba.conf"
        self.pg_service_name = formula

        if not (pg_data_dir / "PG_VERSION").exists():
            self.logger.info(f"Initializing PostgreSQL data directory at {pg_data_dir}")
            run_command(
                [
                    str(self.pg_bin_dir / "initdb"),
                    "-D",
                    str(pg_data_dir),
                    "--encoding=UTF8",
                    "--locale=C",
                ],
                logger=self.logger,
            )

        run_command(["brew", "services", "start", self.pg_service_name], logger=self.logger)

    def install_postgresql_linux(self) -> None:
        """Installs PostgreSQL packages and locates the active cluster config files."""
        require_command("apt-get")
        run_command([*self.sudo_prefix, "apt-get", "update"], logger=self.logger)
        run_command(
            [*self.sudo_prefix, "apt-get", "install", "-y", "postgresql", "postgresql-contrib"],
            logger=self.logger,
        )
        run_command([*self.sudo_prefix, "systemctl", "enable", "--now", "postgresql"], logger=self.logger)

        version_output = run_capture(["psql", "--version"], logger=self.logger)
        match = re.search(r"(\d+)", version_output)
        if not match:
            raise SetupError(f"Unable to detect PostgreSQL major version from: {version_output}")

        major_version = match.group(1)
        self.pg_conf_file = Path(f"/etc/postgresql/{major_version}/main/postgresql.conf")
        self.pg_hba_file = Path(f"/etc/postgresql/{major_version}/main/pg_hba.conf")
        self.pg_service_name = "postgresql"
        self.psql_bin = shutil.which("psql") or "psql"

    def configure_postgresql_conf(self) -> None:
        """Applies the minimal server settings needed for this single-host layout."""
        self.logger.step("Updating postgresql.conf")
        if self.pg_conf_file is None:
            raise SetupError("PostgreSQL config file path is not initialized")

        content = read_text_with_optional_sudo(
            self.pg_conf_file,
            sudo_prefix=self.sudo_prefix,
            logger=self.logger,
        )
        content = self.upsert_setting(content, "listen_addresses", self.pg_string(self.config.pg_listen_addresses))
        content = self.upsert_setting(content, "port", str(self.config.pg_port))
        content = self.upsert_setting(content, "password_encryption", self.pg_string("scram-sha-256"))
        content = self.upsert_setting(content, "timezone", self.pg_string("UTC"))
        content = self.upsert_setting(content, "log_timezone", self.pg_string("UTC"))
        write_text_with_optional_sudo(
            self.pg_conf_file,
            content,
            sudo_prefix=self.sudo_prefix,
            logger=self.logger,
        )
        self.logger.success("postgresql.conf updated")

    def configure_pg_hba(self) -> None:
        """Overwrites only the managed authentication block, preserving unrelated rules."""
        self.logger.step("Updating pg_hba.conf managed block")
        if self.pg_hba_file is None:
            raise SetupError("pg_hba.conf path is not initialized")

        managed_block = self.build_pg_hba_block()
        content = read_text_with_optional_sudo(
            self.pg_hba_file,
            sudo_prefix=self.sudo_prefix,
            logger=self.logger,
        )
        content = self.replace_managed_block(content, managed_block)
        write_text_with_optional_sudo(
            self.pg_hba_file,
            content,
            sudo_prefix=self.sudo_prefix,
            logger=self.logger,
        )
        self.logger.success("pg_hba.conf updated")

    def restart_postgresql(self) -> None:
        """Restarts the service so config and auth changes take effect immediately."""
        self.logger.step("Restarting PostgreSQL service")
        if self.pg_service_name is None:
            raise SetupError("PostgreSQL service name is not initialized")

        if self.system_name == "Darwin":
            run_command(["brew", "services", "restart", self.pg_service_name], logger=self.logger)
        else:
            run_command([*self.sudo_prefix, "systemctl", "restart", self.pg_service_name], logger=self.logger)
        self.logger.success("PostgreSQL service restarted")

    def create_roles(self) -> None:
        """Creates or rotates the four environment-specific login roles."""
        self.logger.step("Creating or updating PostgreSQL roles")
        role_specs = [
            (self.config.dev_app_role, self.dev_app_password),
            (self.config.dev_migrator_role, self.dev_migrator_password),
            (self.config.online_app_role, self.online_app_password),
            (self.config.online_migrator_role, self.online_migrator_password),
        ]
        for role_name, password in role_specs:
            self.logger.info(f"Ensuring role exists: {role_name}")
            sql = f"""
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = {self.pg_literal(role_name)}) THEN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', {self.pg_literal(role_name)}, {self.pg_literal(password)});
  ELSE
    EXECUTE format('ALTER ROLE %I LOGIN PASSWORD %L', {self.pg_literal(role_name)}, {self.pg_literal(password)});
  END IF;
END
$$;
"""
            self.run_psql_admin("postgres", sql)
        self.logger.success("PostgreSQL roles are ready")

    def create_databases(self) -> None:
        """Creates dev and online databases only when they are missing."""
        self.logger.step("Creating PostgreSQL databases when needed")
        database_specs = [
            (self.config.dev_db_name, self.config.dev_migrator_role),
            (self.config.online_db_name, self.config.online_migrator_role),
        ]
        for database_name, owner_name in database_specs:
            self.logger.info(f"Ensuring database exists: {database_name}")
            sql = f"""
SELECT format(
  'CREATE DATABASE %I OWNER %I ENCODING ''UTF8'' TEMPLATE template0',
  {self.pg_literal(database_name)},
  {self.pg_literal(owner_name)}
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_database WHERE datname = {self.pg_literal(database_name)}
)
\\gexec
"""
            self.run_psql_admin("postgres", sql)
        self.logger.success("PostgreSQL databases are ready")

    def configure_privileges(self) -> None:
        """Keeps runtime users low-privilege and reserves schema changes for migrators."""
        self.logger.step("Configuring PostgreSQL database privileges")
        privilege_specs = [
            (self.config.dev_db_name, self.config.dev_app_role, self.config.dev_migrator_role),
            (self.config.online_db_name, self.config.online_app_role, self.config.online_migrator_role),
        ]
        for database_name, app_role, migrator_role in privilege_specs:
            self.logger.info(f"Applying privileges for database: {database_name}")
            sql = f"""
REVOKE ALL ON DATABASE {self.pg_ident(database_name)} FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE {self.pg_ident(database_name)} TO {self.pg_ident(app_role)};
GRANT ALL PRIVILEGES ON DATABASE {self.pg_ident(database_name)} TO {self.pg_ident(migrator_role)};

ALTER DATABASE {self.pg_ident(database_name)} SET timezone TO 'UTC';
ALTER SCHEMA public OWNER TO {self.pg_ident(migrator_role)};
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO {self.pg_ident(app_role)};
GRANT ALL ON SCHEMA public TO {self.pg_ident(migrator_role)};

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON ALL TABLES IN SCHEMA public TO {self.pg_ident(app_role)};
GRANT USAGE, SELECT, UPDATE
ON ALL SEQUENCES IN SCHEMA public TO {self.pg_ident(app_role)};

ALTER DEFAULT PRIVILEGES FOR ROLE {self.pg_ident(migrator_role)} IN SCHEMA public
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO {self.pg_ident(app_role)};

ALTER DEFAULT PRIVILEGES FOR ROLE {self.pg_ident(migrator_role)} IN SCHEMA public
GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO {self.pg_ident(app_role)};
"""
            self.run_psql_admin(database_name, sql)
        self.logger.success("PostgreSQL privileges configured")

    def write_env_files(self) -> None:
        """Generates stable env files that API and migration jobs can reuse directly."""
        self.logger.step("Writing generated PostgreSQL env files")
        write_env_file(
            self.dev_env_file,
            {
                "PG_ENV": "dev",
                "PG_HOST": self.config.pg_host,
                "PG_PORT": str(self.config.pg_port),
                "PG_DATABASE_NAME": self.config.dev_db_name,
                "PG_APP_ROLE": self.config.dev_app_role,
                "PG_APP_PASSWORD": self.dev_app_password,
                "PG_MIGRATOR_ROLE": self.config.dev_migrator_role,
                "PG_MIGRATOR_PASSWORD": self.dev_migrator_password,
                "DATABASE_URL": self.build_database_url(
                    self.config.dev_app_role,
                    self.dev_app_password,
                    self.config.dev_db_name,
                ),
                "DIRECT_URL": self.build_database_url(
                    self.config.dev_migrator_role,
                    self.dev_migrator_password,
                    self.config.dev_db_name,
                ),
            },
        )
        write_env_file(
            self.online_env_file,
            {
                "PG_ENV": "online",
                "PG_HOST": self.config.pg_host,
                "PG_PORT": str(self.config.pg_port),
                "PG_DATABASE_NAME": self.config.online_db_name,
                "PG_APP_ROLE": self.config.online_app_role,
                "PG_APP_PASSWORD": self.online_app_password,
                "PG_MIGRATOR_ROLE": self.config.online_migrator_role,
                "PG_MIGRATOR_PASSWORD": self.online_migrator_password,
                "DATABASE_URL": self.build_database_url(
                    self.config.online_app_role,
                    self.online_app_password,
                    self.config.online_db_name,
                ),
                "DIRECT_URL": self.build_database_url(
                    self.config.online_migrator_role,
                    self.online_migrator_password,
                    self.config.online_db_name,
                ),
            },
        )
        self.logger.success("Generated PostgreSQL env files written")

    def verify_connections(self) -> None:
        """Proves that the generated runtime credentials can really connect."""
        self.logger.step("Verifying PostgreSQL runtime connections")
        connection_specs = [
            (self.config.dev_db_name, self.config.dev_app_role, self.dev_app_password),
            (self.config.online_db_name, self.config.online_app_role, self.online_app_password),
        ]
        for database_name, role_name, password in connection_specs:
            self.logger.info(f"Checking runtime login for {database_name}")
            env = os.environ.copy()
            env["PGPASSWORD"] = password
            run_command(
                [
                    self.psql_bin or "psql",
                    "-h",
                    self.config.pg_host,
                    "-p",
                    str(self.config.pg_port),
                    "-U",
                    role_name,
                    "-d",
                    database_name,
                    "-c",
                    "select current_database(), current_user;",
                ],
                logger=self.logger,
                env=env,
                capture_output=True,
            )
        self.logger.success("PostgreSQL runtime connections verified")

    def run_psql_admin(self, database_name: str, sql: str) -> None:
        """Executes SQL as the local PostgreSQL superuser on each platform."""
        if self.system_name == "Darwin":
            if self.pg_bin_dir is None:
                raise SetupError("PostgreSQL binary directory is not initialized")
            command = [str(self.pg_bin_dir / "psql"), "-v", "ON_ERROR_STOP=1", "-d", database_name]
        else:
            if os.geteuid() == 0:
                require_command("runuser")
                command = ["runuser", "-u", "postgres", "--", "psql", "-v", "ON_ERROR_STOP=1", "-d", database_name]
            else:
                command = ["sudo", "-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-d", database_name]

        run_command(command, logger=self.logger, capture_output=True, input_text=sql)

    @staticmethod
    def upsert_setting(content: str, key: str, value: str) -> str:
        """Replaces a PostgreSQL config setting or appends it if it does not exist."""
        line = f"{key} = {value}"
        pattern = re.compile(rf"^[#\s]*{re.escape(key)}\s*=.*$", re.MULTILINE)
        if pattern.search(content):
            return pattern.sub(line, content)

        stripped = content.rstrip()
        if not stripped:
            return f"{line}\n"
        return f"{stripped}\n\n{line}\n"

    @staticmethod
    def replace_managed_block(content: str, managed_block: str) -> str:
        """Keeps ownership of only the block this script is responsible for."""
        block_pattern = re.compile(
            rf"\n?{re.escape(MANAGED_BLOCK_START)}\n.*?{re.escape(MANAGED_BLOCK_END)}\n?",
            re.DOTALL,
        )
        replacement = f"\n{MANAGED_BLOCK_START}\n{managed_block}{MANAGED_BLOCK_END}\n"
        if block_pattern.search(content):
            updated = block_pattern.sub(replacement, content)
        else:
            updated = content.rstrip() + replacement if content.strip() else replacement.lstrip("\n")
        return updated.rstrip() + "\n"

    def build_pg_hba_block(self) -> str:
        """Builds a predictable localhost-only authentication block for both environments."""
        lines = [
            f"host    {self.config.dev_db_name}    {self.config.dev_app_role},{self.config.dev_migrator_role}    127.0.0.1/32    scram-sha-256",
            f"host    {self.config.dev_db_name}    {self.config.dev_app_role},{self.config.dev_migrator_role}    ::1/128         scram-sha-256",
            f"host    {self.config.online_db_name}    {self.config.online_app_role},{self.config.online_migrator_role}    127.0.0.1/32    scram-sha-256",
            f"host    {self.config.online_db_name}    {self.config.online_app_role},{self.config.online_migrator_role}    ::1/128         scram-sha-256",
        ]
        return "\n".join(lines) + "\n"

    def build_database_url(self, role_name: str, password: str, database_name: str) -> str:
        """Renders the connection string used by the application and migrations."""
        return (
            f"postgresql://{role_name}:{password}@{self.config.pg_host}:"
            f"{self.config.pg_port}/{database_name}?schema=public"
        )

    @staticmethod
    def pg_string(value: str) -> str:
        """Escapes string values for postgresql.conf assignments."""
        escaped = value.replace("'", "''")
        return f"'{escaped}'"

    @staticmethod
    def pg_literal(value: str) -> str:
        """Escapes SQL literal strings used inside psql statements."""
        escaped = value.replace("'", "''")
        return f"'{escaped}'"

    @staticmethod
    def pg_ident(value: str) -> str:
        """Escapes identifiers so the generated SQL remains valid and explicit."""
        escaped = value.replace('"', '""')
        return f'"{escaped}"'


def build_config() -> PostgresConfig:
    """Loads configuration from environment variables with sensible single-host defaults."""
    repo_root = Path(__file__).resolve().parents[2]
    project_name = os.environ.get("PROJECT_NAME", "zook")
    return PostgresConfig(
        project_name=project_name,
        pg_port=int(os.environ.get("PG_PORT", "5432")),
        pg_host=os.environ.get("PG_HOST", "127.0.0.1"),
        pg_listen_addresses=os.environ.get("PG_LISTEN_ADDRESSES", "127.0.0.1,::1").strip("'"),
        pg_brew_formula=os.environ.get("PG_BREW_FORMULA", "postgresql@16"),
        dev_db_name=os.environ.get("DEV_DB_NAME", f"{project_name}_dev"),
        online_db_name=os.environ.get("ONLINE_DB_NAME", f"{project_name}_online"),
        dev_app_role=os.environ.get("DEV_APP_ROLE", f"{project_name}_dev_app"),
        dev_migrator_role=os.environ.get("DEV_MIGRATOR_ROLE", f"{project_name}_dev_migrator"),
        online_app_role=os.environ.get("ONLINE_APP_ROLE", f"{project_name}_online_app"),
        online_migrator_role=os.environ.get("ONLINE_MIGRATOR_ROLE", f"{project_name}_online_migrator"),
        repo_root=repo_root,
    )


def parse_args() -> argparse.Namespace:
    """Keeps the CLI simple while documenting the supported env vars."""
    parser = argparse.ArgumentParser(
        description="Install and configure one PostgreSQL instance for dev + online on the same host.",
        epilog=(
            "Environment overrides: PROJECT_NAME, PG_PORT, PG_HOST, PG_LISTEN_ADDRESSES, "
            "PG_BREW_FORMULA, DEV_DB_NAME, ONLINE_DB_NAME, DEV_APP_ROLE, DEV_MIGRATOR_ROLE, "
            "ONLINE_APP_ROLE, ONLINE_MIGRATOR_ROLE, DEV_APP_PASSWORD, DEV_MIGRATOR_PASSWORD, "
            "ONLINE_APP_PASSWORD, ONLINE_MIGRATOR_PASSWORD"
        ),
    )
    return parser.parse_args()


def main() -> int:
    """Parses args, runs the setup, and converts failures into a clean exit code."""
    parse_args()
    try:
        PostgresDualEnvSetup(build_config()).run()
    except SetupError as exc:
        print(f"[postgres-dual][error] {exc}", file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
