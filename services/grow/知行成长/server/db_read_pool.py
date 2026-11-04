"""Bounded, schema-pinned connections for explicitly opted-in read transactions.

No result or identity cache. A connection is exclusively leased until rollback;
different DSNs/schemas never reuse the same physical session.
"""
import re
import time
from functools import wraps
from threading import Condition

import psycopg2
from psycopg2.extensions import parse_dsn


class ReadPool:
    def __init__(self, size=6, wait=5, idle=120, lifetime=600):
        self.size, self.wait, self.idle, self.lifetime = size, wait, idle, lifetime
        self.condition = Condition()
        self.available = []
        self.total = 0
        self.generation = 0

    def acquire(self, dsn, schema):
        key = (dsn, schema)
        deadline = time.monotonic() + self.wait
        with self.condition:
            while True:
                now = time.monotonic()
                for entry in self.available[:]:
                    _, conn, born, returned, _ = entry
                    if conn.closed or now-returned > self.idle or now-born > self.lifetime:
                        self.available.remove(entry)
                        conn.close()
                        self.total -= 1
                for entry in reversed(self.available):
                    if entry[0] == key:
                        self.available.remove(entry)
                        return entry
                # Evict an idle session for another schema rather than growing
                # one unbounded pool per user.
                if self.total >= self.size and self.available:
                    self.available.pop(0)[1].close()
                    self.total -= 1
                if self.total < self.size:
                    self.total += 1
                    generation = self.generation
                    break
                remaining = deadline-time.monotonic()
                if remaining <= 0:
                    raise psycopg2.OperationalError('只读连接暂忙，请稍后重试。')
                self.condition.wait(remaining)
        conn = None
        try:
            settings = parse_dsn(dsn)
            options = settings.get('options', '')
            if schema is not None:
                # libpq splits options on whitespace; quote the SQL identifier
                # and escape option whitespace/backslashes independently.
                identifier = '"' + schema.replace('"', '""') + '"'
                identifier = re.sub(r'([\s\\])', r'\\\1', identifier)
                options += ' -csearch_path=' + identifier
            conn = psycopg2.connect(dsn, options=options,
                connect_timeout=int(settings.get('connect_timeout', 5)),
                keepalives=1, keepalives_idle=30, keepalives_interval=10, keepalives_count=3)
            conn.set_session(readonly=True, isolation_level='REPEATABLE READ', autocommit=False)
            return (key, conn, time.monotonic(), 0, generation)
        except BaseException:
            if conn is not None:
                conn.close()
            with self.condition:
                self.total -= 1
                self.condition.notify()
            raise

    def release(self, entry):
        key, conn, born, _, generation = entry
        healthy = not conn.closed
        if healthy:
            try:
                conn.rollback()
            except psycopg2.Error:
                healthy = False
        with self.condition:
            if healthy and generation == self.generation and time.monotonic()-born < self.lifetime:
                self.available.append((key, conn, born, time.monotonic(), generation))
            else:
                conn.close()
                self.total -= 1
            self.condition.notify()

    def close(self):
        with self.condition:
            self.generation += 1
            for entry in self.available:
                entry[1].close()
            self.total -= len(self.available)
            self.available.clear()
            self.condition.notify_all()


read_pool = ReadPool()


def retry_read(read):
    """Replay an entire opted-in read once after a lost/stale connection.

    Never applied to writes or ordinary SQL/data errors; the context manager
    has already rolled back/discarded the previous lease before retrying.
    """
    @wraps(read)
    def run(*args, **kwargs):
        try:
            return read(*args, **kwargs)
        except (psycopg2.OperationalError, psycopg2.InterfaceError) as error:
            if error.pgcode and not error.pgcode.startswith('08'):
                raise
            return read(*args, **kwargs)
    return run
