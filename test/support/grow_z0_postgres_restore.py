#!/usr/bin/env python3
"""Z0 synthetic dual-database backup/restore rehearsal. Creates a NEW local cluster only."""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys


def run(args, **kwargs):
    return subprocess.run(list(map(str, args)), check=True, **kwargs)


def snapshot(db, connection):
    with connection(db) as c, c.cursor() as q:
        q.execute("SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1,2")
        result = {}
        from psycopg2 import sql
        for schema, table in q.fetchall():
            q.execute(sql.SQL('SELECT row_to_json(t)::text FROM {}.{} t ORDER BY row_to_json(t)::text').format(sql.Identifier(schema), sql.Identifier(table)))
            rows = [r[0] for r in q.fetchall()]
            result[schema+'.'+table] = {'rows': len(rows), 'sha256': hashlib.sha256('\n'.join(rows).encode()).hexdigest()}
        return result


def main(root, grow_server):
    root = root.resolve()
    root.mkdir(parents=True, mode=0o700, exist_ok=False)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
    pgdata = root/'pgdata'
    with (root/'init.log').open('w') as log:
        run(['initdb','-D',pgdata,'-U','z0_qa','--auth=trust','--encoding=UTF8','--locale=C'], stdout=log, stderr=log)
    run(['pg_ctl','-D',pgdata,'-l',root/'postgres.log','-o',f'-h 127.0.0.1 -p {port} -k {root}','-w','start'], stdout=subprocess.DEVNULL)
    args = ['-h','127.0.0.1','-p',str(port),'-U','z0_qa']
    def dsn(db): return f'postgresql://z0_qa@127.0.0.1:{port}/{db}'
    try:
        for name in ('zook_source','grow_source','zook_restored','grow_restored'):
            run(['createdb',*args,name])
        environment = {**os.environ, 'DATABASE_URL':dsn('zook_source'), 'DIRECT_URL':dsn('zook_source')}
        with (root/'zook-migrations.log').open('w') as log:
            run(['node','--experimental-transform-types','src/infrastructure/database/postgres/migrate.ts'],env=environment,stdout=log,stderr=log)
        with (root/'zook-postgres-tests.log').open('w') as log:
            run(['npm','run','test:postgres:lighttick'],env={**environment,'LIGHTTICK_TEST_DATABASE_URL':dsn('zook_source')},stdout=log,stderr=log)
        # Import actual locked Grow domain code; no provider or external account is contacted.
        sys.path.insert(0,str(grow_server.resolve()))
        os.environ['DATABASE_URL'] = dsn('grow_source')
        import db
        import study_notes
        import tenancy
        with db.connect(tenant=False) as c:
            c.execute('CREATE SCHEMA qa_alice'); c.execute('CREATE SCHEMA qa_bob')
        for who in ('qa_alice','qa_bob'):
            token = tenancy.current_user.set({'schema_name':who})
            try:
                body = study_notes.Draft(notes='synthetic '+who,answers={'q1':'synthetic answer'},version='a'*64,revision=0,key='z0-note-operation-0001')
                first = study_notes.save('yingyu','same-course.md',body)
                assert study_notes.save('yingyu','same-course.md',body) == first
            finally: tenancy.current_user.reset(token)
        tree = ast.parse((grow_server/'action_plans.py').read_text())
        schema = next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='SCHEMA' for t in n.targets))
        with db.connect(tenant=False) as c:
            c.execute('SET search_path TO qa_alice'); c.executescript(schema)
            c.execute('INSERT INTO action_source_outbox VALUES (?,?,?,?,?,?,?)',('z0-source-operation-0001','{}','pending',0,'2026-11-01T00:00:00Z',None,'{}'))
        import psycopg2
        connection = lambda name: psycopg2.connect(dsn(name))
        evidence = {'kind':'synthetic_only','zook_migrations_and_pg_tests':True,'grow_notes_idempotency':True,'databases':{}}
        for prefix in ('zook','grow'):
            archive = root/(prefix+'.dump')
            run(['pg_dump',*args,'-Fc','-f',archive,prefix+'_source'])
            archive.chmod(0o600)
            run(['pg_restore',*args,'--exit-on-error','--no-owner','-d',prefix+'_restored',archive])
            before = snapshot(prefix+'_source',connection); after = snapshot(prefix+'_restored',connection)
            assert before == after
            evidence['databases'][prefix] = {'archive_sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'tables':before,'restored_exactly':True}
        (root/'evidence.json').write_text(json.dumps(evidence,indent=2)+'\n')
        (root/'evidence.json').chmod(0o600)
        print(json.dumps({'dual_database_restore':True,'synthetic_only':True,'grow_private_notes':2,'pending_source_operation':1,'evidence':str(root/'evidence.json')}))
    finally:
        run(['pg_ctl','-D',pgdata,'-m','fast','-w','stop'],stdout=subprocess.DEVNULL)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,required=True)
    parser.add_argument('--grow-server',type=Path,required=True)
    a = parser.parse_args(); main(a.root,a.grow_server)
