import importlib.util
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
import unittest

spec = importlib.util.spec_from_file_location("domains", Path(__file__).resolve().parents[1] / "frogsleep_domain_acceptance.py")
domains = importlib.util.module_from_spec(spec)
spec.loader.exec_module(domains)


class DomainTest(unittest.TestCase):
    def run_fixture(self, spa=False, wrong_redirect=False, health=None):
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                if self.path == "/api/health":
                    body = json.dumps({"data": health if health is not None else {"status": "ok", "version": "qa"}})
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                elif spa:
                    body = "<script>window.__ADMIN_RUNTIME_CONFIG__={}</script>"
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html")
                elif self.path.endswith("buddy-invitation"):
                    body = '<a href="frogsleep://buddy-invitation?mode=preview&token=">Open</a>'
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html")
                else:
                    body = ""
                    self.send_response(302)
                    host = self.path.rsplit("/", 1)[1]
                    self.send_header("Location", "https://untrusted.invalid/" if wrong_redirect else f"frogsleep://{host}?mode=preview")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Referrer-Policy", "no-referrer")
                self.end_headers()
                self.wfile.write(body.encode())

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            return domains.run(f"http://127.0.0.1:{server.server_port}", "qa")
        finally:
            server.shutdown(); server.server_close(); thread.join()

    def test_real_handoffs_pass_without_following_redirects(self):
        self.assertTrue(self.run_fixture()["passed"])

    def test_spa_200_is_a_failure(self):
        self.assertFalse(self.run_fixture(spa=True)["passed"])

    def test_foreign_redirect_is_a_failure(self):
        self.assertFalse(self.run_fixture(wrong_redirect=True)["passed"])

    def test_bad_health_fails_closed(self):
        self.assertFalse(self.run_fixture(health=[])["passed"])

    def test_scope_refuses_credentials_paths_and_foreign_origins(self):
        for url in ["https://untrusted.invalid", "http://app-dev.youwoai.net", "https://app-dev.youwoai.net/path", "https://user:PRIVATE@app-dev.youwoai.net", "https://app-dev.youwoai.net?x=1"]:
            with self.assertRaises(ValueError): domains.origin(url)


if __name__ == "__main__":
    unittest.main()
