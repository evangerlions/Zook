#!/usr/bin/env bash
set -euo pipefail

# Dedicated N3 fixture only. Never points at the N2 cluster or a developer database.
: "${LIGHTTICK_N3_PG_ARTIFACTS:?Set a new N3 artifact directory}"
pg_bin="${LIGHTTICK_N3_PG_BIN:-/opt/homebrew/opt/postgresql@15/bin}"
fixture_dir="$LIGHTTICK_N3_PG_ARTIFACTS"
fixture_data="$fixture_dir/pgdata"
fixture_port=55443
fixture_user=native_continuation_qa
fixture_db=native_continuation_qa
mkdir -p "$fixture_dir"
if [[ ! -f "$fixture_data/PG_VERSION" ]]; then
  "$pg_bin/initdb" -D "$fixture_data" -U "$fixture_user" --auth=trust --encoding=UTF8 --locale=C > "$fixture_dir/pg-init.log" 2>&1
fi
if ! "$pg_bin/pg_ctl" -D "$fixture_data" status > /dev/null 2>&1; then
  "$pg_bin/pg_ctl" -D "$fixture_data" -l "$fixture_dir/pg-server.log" -o "-h 127.0.0.1 -p $fixture_port -k /tmp" -w start
fi
if ! "$pg_bin/psql" -h 127.0.0.1 -p "$fixture_port" -U "$fixture_user" -d postgres -Atqc "SELECT 1 FROM pg_database WHERE datname='$fixture_db'" | rg -q '^1$'; then
  "$pg_bin/createdb" -h 127.0.0.1 -p "$fixture_port" -U "$fixture_user" "$fixture_db"
fi
cat > "$fixture_dir/postgres-env.json" <<EOF
{"host":"127.0.0.1","port":$fixture_port,"database":"$fixture_db","user":"$fixture_user","data_directory":"$fixture_data","dsn":"postgresql://$fixture_user@127.0.0.1:$fixture_port/$fixture_db","api_started":false}
EOF
cat "$fixture_dir/postgres-env.json"
