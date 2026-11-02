"""Real PostgreSQL content/version/isolation tests, using disposable schemas only."""
import json
import os
from pathlib import Path
import sys
import unittest
import uuid
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]/'services/grow/知行成长/server'))
import db
from copilot.core import Problem
from postgres_content import PostgresContent
from tenancy import current_user
from cloud_content import Documents
from psycopg2 import sql


@unittest.skipUnless(os.environ.get('TEST_GROW_POSTGRES_DSN'), 'isolated PostgreSQL DSN required')
class ContentTest(unittest.TestCase):
    def setUp(self):
        self.saved = db.DATABASE_URL
        self.old_schema = os.environ.get('GROW_DATABASE_SCHEMA')
        self.old_backend = os.environ.get('PLAN_CONTENT_BACKEND')
        db.DATABASE_URL = os.environ['TEST_GROW_POSTGRES_DSN']
        self.schema = 'grow_test_' + uuid.uuid4().hex
        os.environ.update(GROW_DATABASE_SCHEMA=self.schema, PLAN_CONTENT_BACKEND='postgresql')
        db.ensure_schema()
        self.schemas = [self.schema]
        self.content = PostgresContent()
        self.content.bootstrap()

    def tearDown(self):
        from db_read_pool import read_pool
        read_pool.close()
        with db.psycopg2.connect(db.DATABASE_URL) as connection:
            with connection.cursor() as cursor:
                for schema in self.schemas:
                    cursor.execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(schema)))
        db.DATABASE_URL = self.saved
        for key, value in [('GROW_DATABASE_SCHEMA', self.old_schema), ('PLAN_CONTENT_BACKEND', self.old_backend)]:
            if value is None: os.environ.pop(key, None)
            else: os.environ[key] = value

    def test_immutable_versions_cas_and_retry(self):
        content = self.content; root = content.head(); path = '学习计划/plan-test/学习规划.md'
        first = content.prepare(root, {path: 'first'}, 'operation-one')
        self.assertEqual(first, content.prepare(root, {path: 'first'}, 'operation-one'))
        competing = content.prepare(root, {path: 'competing'}, 'operation-two')
        content.advance(first); content.advance(first)
        with self.assertRaises(Problem): content.advance(competing)
        second = content.prepare(first, {path: 'second'}, 'operation-three'); content.advance(second)
        self.assertEqual(content.read_text(path, first), 'first')
        self.assertEqual(content.read_text(path, second), 'second')
        self.assertTrue(content.contains(first, second))
        self.assertFalse(content.contains(competing, second))
        self.assertIsNone(content.read_text('学习计划/missing.md', missing=True))
        for invalid in ('/etc/passwd', '../学习计划/a', '学习计划/../a', 'other/file'):
            with self.assertRaises(Problem): content.read_text(invalid)

    def test_read_pool_and_schema_configuration_never_fall_back_to_public(self):
        with db.connect(readonly=True) as connection:
            self.assertEqual(connection.execute('SELECT current_schema()').fetchone()[0], self.schema)
        for value in ('', 'public', 'pg_catalog', 'grow_invalid;DROP'):
            with patch.dict(os.environ, {'GROW_DATABASE_SCHEMA': value}):
                with self.assertRaises(ValueError): db.default_schema()

    def test_tenant_cannot_read_another_accounts_revision(self):
        path = '英文阅读/网页课程/第001课.md'
        revision = self.content.prepare(self.content.head(), {path: 'owner private course'}, 'owner-course')
        self.content.advance(revision)
        schema = 'grow_test_' + uuid.uuid4().hex; self.schemas.append(schema)
        with db.psycopg2.connect(db.DATABASE_URL) as connection:
            with connection.cursor() as cursor:
                cursor.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(schema)))
        token = current_user.set({'schema_name': schema})
        try:
            other = PostgresContent(); other.bootstrap()
            self.assertIsNone(other.read_text(path, missing=True))
            with self.assertRaises(Problem): other.read_text(path, revision)
        finally: current_user.reset(token)

    def test_journal_recovers_lost_advance_ack_and_keeps_private_documents(self):
        class Store:
            def conn(self): return db.connect()
        documents = Documents(Store(), self.content); documents.initialize()
        path = '英文阅读/网页课程/第001课.md'; private = '认知阅读/学习记录.md'
        with db.connect() as connection:
            connection.execute('CREATE TABLE effect (id INTEGER PRIMARY KEY, value TEXT)')
        advance = self.content.advance
        def lost_ack(revision):
            advance(revision)
            raise RuntimeError('synthetic lost acknowledgement')
        with patch.object(self.content, 'advance', side_effect=lost_ack):
            with self.assertRaises(RuntimeError):
                documents.publish('journal-test', {'request': 1}, {path: '# Course', private: 'private note'},
                    [('INSERT INTO effect VALUES (?,?)', [1, 'once'])], result={'ok': True})
        documents.recover()
        replay = documents.publish('journal-test', {'request': 1}, {path: '# Course', private: 'private note'})
        self.assertEqual(replay['storage'], 'postgresql')
        self.assertEqual(documents.read(path), '# Course')
        self.assertEqual(documents.read(private), 'private note')
        self.assertEqual(documents.metadata(private)['storage'], 'database')
        with db.connect() as connection:
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM effect').fetchone()[0], 1)
        with self.assertRaises(Problem): documents.publish('journal-test', {'request': 2}, {})


if __name__ == '__main__': unittest.main()
