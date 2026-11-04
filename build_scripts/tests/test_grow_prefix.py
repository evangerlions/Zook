import asyncio
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'services/grow/知行成长/server'))
from web_prefix import PrefixApp, rewrite_asset, prepare


class PrefixTest(unittest.TestCase):
    def test_build_assets_keeps_requests_auth_checks_and_navigation_in_prefix(self):
        root = ROOT / 'services/grow/知行成长/server/static'
        with tempfile.TemporaryDirectory() as temp:
            for name in ('index.html', 'login.html', 'login.js', 'account.js'):
                (Path(temp) / name).write_bytes((root / name).read_bytes())
            prepare(temp, '/grow')
            account = (Path(temp) / 'account.js').read_text()
            self.assertIn("url.pathname.startsWith('/grow/api/')", account)
            self.assertIn("originalFetch('/grow/api/auth/me'", account)
            self.assertIn('href="/grow/"', account)
            self.assertIn("location.replace('/grow/'+continuation)", (Path(temp) / 'login.js').read_text())
            self.assertIn('src="/grow/static/login.js', (Path(temp) / 'login.html').read_text())
            for path in Path(temp).iterdir():
                self.assertEqual(rewrite_asset(path.read_text(), '/grow'), path.read_text(), 'build must be idempotent')
        self.assertEqual(rewrite_asset("fetch('https://external.test/api/a'); api('/jobs')", '/grow'),
                         "fetch('https://external.test/api/a'); api('/jobs')")

    def test_prefix_stripped_before_auth_redirect_cookie_and_stream_preserved(self):
        received = []
        async def application(scope, receive, send):
            received.append(scope)
            await send({'type': 'http.response.start', 'status': 303, 'headers': [
                (b'location', b'/login'), (b'set-cookie', b'grow_session=secret; Path=/; HttpOnly'),
                (b'set-cookie', b'other=1; Path=/; Max-Age=0')]})
            await send({'type': 'http.response.body', 'body': b'first', 'more_body': True})
            await send({'type': 'http.response.body', 'body': b'second'})
        async def run(path):
            messages = []
            async def send(message): messages.append(message)
            await PrefixApp(application, '/grow')({'type': 'http', 'path': path,
                'raw_path': path.encode(), 'query_string': b'x=a%2Bb'}, None, send)
            return messages
        messages = asyncio.run(run('/grow/api/data'))
        self.assertEqual(received[0]['path'], '/api/data')
        self.assertEqual(received[0]['raw_path'], b'/api/data')
        self.assertIn((b'location', b'/grow/login'), messages[0]['headers'])
        cookies = [v for k, v in messages[0]['headers'] if k == b'set-cookie']
        self.assertTrue(all(b'Path=/grow/;' in v for v in cookies))
        self.assertEqual([m['body'] for m in messages[1:]], [b'first', b'second'])
        self.assertIn((b'location', b'/grow/?x=a%2Bb'), asyncio.run(run('/grow'))[0]['headers'])

    def test_invalid_prefix_rejected(self):
        for prefix in ('//evil.test', '/grow/..', '/grow?a=1'):
            with self.assertRaises(ValueError): rewrite_asset('', prefix)


if __name__ == '__main__': unittest.main()
