"""Immutable documents stored alongside Grow records in tenant-isolated PostgreSQL."""
import json
from pathlib import PurePosixPath

import db
from copilot.core import digest, encoded, fail
from tenancy import current_user

TABLES = '''
CREATE TABLE IF NOT EXISTS grow_content_blobs (hash TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS grow_content_revisions (id TEXT PRIMARY KEY, parent TEXT, tree TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS grow_content_heads (id INTEGER PRIMARY KEY CHECK (id=1), revision TEXT NOT NULL);
'''
ROOTS = ('学习计划', '每日认知与通识学习', '认知阅读', '英文阅读', '结构化表达')


class PostgresContent:
    backend = 'postgresql'
    repository, branch, prefix = 'zook/grow', 'postgresql', ''

    def __init__(self):
        user = current_user.get()
        self.schema = user['schema_name'] if user else db.default_schema()

    def conn(self):
        return db.connect(tenant=False, schema=self.schema)

    def validate(self):
        with self.conn() as connection: connection.executescript(TABLES)

    def path(self, relative):
        if not isinstance(relative, str): fail('invalid', '资料路径无效。', 422)
        path = PurePosixPath(relative)
        if (path.is_absolute() or '..' in path.parts or '\\' in relative or
                str(path) != relative or not path.parts or path.parts[0] not in ROOTS or
                any(ord(char) < 32 for char in relative)):
            fail('invalid', '资料路径无效。', 422)
        return relative

    def head(self):
        with self.conn() as connection:
            row = connection.execute('SELECT revision FROM grow_content_heads WHERE id=1').fetchone()
        return row[0] if row else None

    def bootstrap(self):
        self.validate()
        revision = digest('zook-grow-content-root')
        with self.conn() as connection:
            connection.execute('INSERT INTO grow_content_revisions VALUES (?,NULL,?) ON CONFLICT(id) DO NOTHING',
                               (revision, '{}'))
            connection.execute('INSERT INTO grow_content_heads VALUES (1,?) ON CONFLICT(id) DO NOTHING', (revision,))

    def tree(self, revision):
        with self.conn() as connection:
            row = connection.execute('SELECT tree FROM grow_content_revisions WHERE id=?', (revision,)).fetchone()
        if not row: fail('not_found', '内容版本不存在。', 404)
        return json.loads(row[0])

    def read_text(self, relative, ref=None, missing=False):
        self.path(relative)
        revision = ref or self.head()
        fingerprint = self.tree(revision).get(relative) if revision else None
        if not fingerprint:
            if missing: return None
            fail('not_found', '尚未保存该资料。', 404)
        with self.conn() as connection:
            row = connection.execute('SELECT body FROM grow_content_blobs WHERE hash=?', (fingerprint,)).fetchone()
        if not row or digest(row[0]) != fingerprint: fail('content_hash', '资料内容校验失败。', 409)
        return row[0]

    def exists(self, relative, ref=None):
        return self.read_text(relative, ref, missing=True) is not None

    def prepare(self, head, files, operation):
        tree = self.tree(head)
        for path, body in files.items():
            self.path(path)
            if not isinstance(body, str) or len(body.encode()) > 1_000_000:
                fail('invalid', '资料须为不超过 1 MB 的 UTF-8 文本。', 422)
            tree[path] = digest(body)
        revision = digest(encoded({'parent': head, 'tree': tree, 'operation': operation}))
        with self.conn() as connection:
            for body in files.values():
                connection.execute('INSERT INTO grow_content_blobs VALUES (?,?) ON CONFLICT(hash) DO NOTHING',
                                   (digest(body), body))
            connection.execute('INSERT INTO grow_content_revisions VALUES (?,?,?) ON CONFLICT(id) DO NOTHING',
                               (revision, head, encoded(tree)))
        return revision

    def advance(self, revision):
        with self.conn() as connection:
            candidate = connection.execute('SELECT parent FROM grow_content_revisions WHERE id=?', (revision,)).fetchone()
            if not candidate: fail('not_found', '内容版本不存在。', 404)
            head = connection.execute('SELECT revision FROM grow_content_heads WHERE id=1 FOR UPDATE').fetchone()
            if head and head[0] == revision: return
            if not head or head[0] != candidate[0]: fail('content_conflict', '资料已更新，请重新读取后保存。', 409)
            connection.execute('UPDATE grow_content_heads SET revision=? WHERE id=1', (revision,))

    def contains(self, revision, head):
        if not revision or not head: return False
        with self.conn() as connection:
            row = connection.execute('''WITH RECURSIVE ancestors AS (
                SELECT id,parent FROM grow_content_revisions WHERE id=?
                UNION SELECT r.id,r.parent FROM grow_content_revisions r JOIN ancestors a ON r.id=a.parent)
                SELECT 1 FROM ancestors WHERE id=?''', (head, revision)).fetchone()
        return row is not None

    def url(self, relative, ref):
        self.path(relative)
        return None  # Existing authenticated course APIs serve database documents.
