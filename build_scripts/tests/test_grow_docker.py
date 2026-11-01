"""Explicit real-Docker tests: RUN_GROW_DOCKER_TESTS=1. No external business services."""
import hashlib
import json
import os
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import grow_group_state as s

@unittest.skipUnless(os.getenv('RUN_GROW_DOCKER_TESTS')=='1','opt-in real Docker required')
class LiteralDockerTest(unittest.TestCase):
    def test_literal_env_and_actual_configuration_binding(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);env=p/'app.env';env.write_text('DATABASE_URL=postgresql://u:p@host/${TARGET_DB}\nAPP_PASSWORD=literal$UNSET$$double\n')
            template=p/'compose.json';template.write_text(json.dumps({'services':{'api':{'image':'python:3.12-slim-bookworm','command':['python','-c','print(1)'],'env_file':[str(env)]}}}))
            project='z1-literal-'+uuid.uuid4().hex[:8]
            config=s.render(p,project,[template],{'TARGET_DB':'zook','UNSET':'changed'})
            snapshot=p/'frozen.json';s.freeze(snapshot,config)
            group={'project_name':project,'snapshot':str(snapshot),'snapshot_sha256':hashlib.sha256(snapshot.read_bytes()).hexdigest(),'images':{'api':s.image_id('python:3.12-slim-bookworm')}}
            try:
                s.docker('compose','-p',project,'-f',snapshot,'create')
                actual=s.container(project,'api')['Config']['Env']
                self.assertIn('APP_PASSWORD=literal$UNSET$$double',actual)
                self.assertIn('DATABASE_URL=postgresql://u:p@host/${TARGET_DB}',actual)
                self.assertTrue(s.configuration_matches(group,p))
                altered=p/'changed.json';config['services']['api']['environment']['APP_PASSWORD']='changed';s.freeze(altered,config)
                s.docker('compose','-p',project,'-f',altered,'create','--force-recreate')
                self.assertFalse(s.configuration_matches(group,p),'same image with changed env must invalidate acceptance')
            finally:s.docker('compose','-p',project,'-f',snapshot,'down')

if __name__=='__main__':unittest.main()
