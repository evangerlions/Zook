import hashlib
import io
import json
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import subprocess
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import grow_source as s


def archive(files):
    out=io.BytesIO()
    with tarfile.open(fileobj=out,mode='w') as t:
        for name,body in files.items():
            item=tarfile.TarInfo(name);item.size=len(body);t.addfile(item,io.BytesIO(body))
    return out.getvalue()


class GrowSourceTest(unittest.TestCase):
    def test_exact_lock_and_no_secret_build_context(self):
        files={'Dockerfile':b'FROM python:3.12-slim-bookworm\n', 'requirements.lock':b'locked', 'requirements.txt':b'-r requirements.lock', '.dockerignore':b'**/.env', '知行成长/server/app.py':b'app', '知行成长/server/.env':b'secret', '知行成长/server/tests/test.py':b'test', 'private.md':b'private'}
        data=archive(files)
        lock={'schema_version':1,'repository':'xiaohao19910303/grow','commit':'a'*40,'archive_sha256':hashlib.sha256(data).hexdigest(),'dockerfile_sha256':hashlib.sha256(files['Dockerfile']).hexdigest(),'requirements_lock_sha256':hashlib.sha256(files['requirements.lock']).hexdigest(),'base_image':'python@sha256:'+'b'*64,'protocol_version':1}
        with tempfile.TemporaryDirectory() as d:
            s.extract_context(data,lock,Path(d))
            self.assertFalse((Path(d)/'private.md').exists());self.assertFalse((Path(d)/'知行成长/server/.env').exists())
            self.assertFalse((Path(d)/'知行成长/server/tests/test.py').exists())
            self.assertIn(lock['base_image'],(Path(d)/'Dockerfile').read_text())
        lock['archive_sha256']='0'*64
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError):s.extract_context(data,lock,Path(d))

    def test_floating_ref_and_foreign_repository_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'lock.json';p.write_text(json.dumps({'schema_version':1,'repository':'evil/repo','commit':'main'}))
            with self.assertRaises(ValueError):s.read_lock(p)

    def test_missing_locked_object_never_falls_back_to_head(self):
        calls=[]
        def run(args,**kwargs):
            calls.append(args)
            if 'config' in args:return subprocess.CompletedProcess(args,0,b'https://github.com/xiaohao19910303/grow.git',b'')
            return subprocess.CompletedProcess(args,1,b'',b'')
        with patch.object(s.subprocess,'run',side_effect=run):
            with self.assertRaises(ValueError):s.read_archive(Path('/mirror'),{'commit':'a'*40})
        self.assertEqual(calls[-1][-1],'a'*40)
        self.assertFalse(any('HEAD' in a for call in calls for a in call))

    def test_selected_symlink_rejected(self):
        out=io.BytesIO()
        with tarfile.open(fileobj=out,mode='w') as t:
            item=tarfile.TarInfo('知行成长/server/app.py');item.type=tarfile.SYMTYPE;item.linkname='/private';t.addfile(item)
        data=out.getvalue()
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError):s.extract_context(data,{'archive_sha256':hashlib.sha256(data).hexdigest()},Path(d))

if __name__=='__main__':unittest.main()
