import base64
import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import grow_plan as p

class PlanTest(unittest.TestCase):
    def test_disabled_never_reads_files(self):
        self.assertIsNone(p.prepare(Path('/missing'),'dev',Path('/missing/api.env'),{}))

    def test_same_database_and_mismatched_credentials_rejected(self):
        repo=Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as d:
            api=Path(d)/'api.env';api.write_text('DATABASE_URL=postgresql://u:p@host/shared\nGROW_ACTION_BRIDGE_SECRET=same\n')
            grow=Path(d)/'grow.env'
            base={'DATABASE_URL':'postgresql://different:secret@other/shared','GROW_ACTION_BRIDGE_SECRET':'same','ACCOUNT_ENCRYPTION_KEY':base64.urlsafe_b64encode(b'x'*32).decode(),'APP_PASSWORD':'a'*24,'GROW_PUBLIC_URL':'https://grow.test','LIGHTTICK_BRIDGE_URL':'https://zook.test','PLAN_CONTENT_BACKEND':'github','CLOUD_DEPLOY':'1','FORWARDED_ALLOW_IPS':'127.0.0.1'}
            def save():grow.write_text(''.join(k+'='+v+'\n' for k,v in base.items()))
            en={'GROW_DEPLOY_ENABLED':'1','GROW_APP_ENV_FILE':str(grow),'GROW_SOURCE_MIRROR':'/mirror'}
            save()
            with self.assertRaisesRegex(ValueError,'distinct database'):p.prepare(repo,'dev',api,en)
            base['DATABASE_URL']='postgresql://u:p@host/grow';base['GROW_ACTION_BRIDGE_SECRET']='wrong';save()
            with self.assertRaisesRegex(ValueError,'credentials must match'):p.prepare(repo,'dev',api,en)
            base['GROW_ACTION_BRIDGE_SECRET']='same';save()
            self.assertEqual(p.prepare(repo,'dev',api,en)['host_port'],'8757')
            en.pop('GROW_SOURCE_MIRROR')
            base['GROW_PUBLIC_URL']='https://app-dev.youwoai.net/grow';save()
            self.assertEqual(p.prepare(repo,'dev',api,en)['mirror'], str(repo/'services/grow'))
            base['GROW_PUBLIC_URL']='https://app-dev.youwoai.net/config';save()
            with self.assertRaisesRegex(ValueError,'HTTPS origins'):
                p.prepare(repo,'dev',api,en)

if __name__=='__main__':unittest.main()
