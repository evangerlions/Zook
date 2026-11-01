#!/usr/bin/env python3
"""Run group-admission checks against a NEW loopback PostgreSQL cluster only."""
import argparse
import json
import os
from pathlib import Path
import socket
import subprocess


def run(arguments, **kwargs):
    return subprocess.run(list(map(str, arguments)), check=True, **kwargs)


def main(root):
    root = root.resolve()
    root.mkdir(parents=True, mode=0o700, exist_ok=False)
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    pgdata = root / "pgdata"
    with (root / "init.log").open("w") as log:
        run(["initdb", "-D", pgdata, "-U", "bodylog_group_qa", "--auth=trust", "--encoding=UTF8", "--locale=C"], stdout=log, stderr=log)
    marker = {"purpose": "bodylog-group-admission-synthetic-only", "port": port}
    (root / "cluster.json").write_text(json.dumps(marker, indent=2) + "\n")
    started = False
    try:
        run(["pg_ctl", "-D", pgdata, "-l", root / "postgres.log", "-o", f"-h 127.0.0.1 -p {port} -k ''", "-w", "start"])
        started = True
        run(["createdb", "-h", "127.0.0.1", "-p", port, "-U", "bodylog_group_qa", "bodylog_group_qa"])
        environment = {
            **os.environ,
            "BODYLOG_GROUP_TEST_DATABASE_URL": f"postgresql://bodylog_group_qa@127.0.0.1:{port}/bodylog_group_qa",
            "BODYLOG_GROUP_TEST_DIRECTORY": str(root),
        }
        result = subprocess.run(["node", "--experimental-transform-types", "--test", "test/integration/bodylog-group-admission-postgres.test.ts"], env=environment)
        (root / "result.json").write_text(json.dumps({**marker, "exit_code": result.returncode}, indent=2) + "\n")
        return result.returncode
    finally:
        if started:
            run(["pg_ctl", "-D", pgdata, "-m", "fast", "-w", "stop"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    arguments = parser.parse_args()
    raise SystemExit(main(arguments.root))
