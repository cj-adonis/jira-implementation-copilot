"""Regression tests for immediate login-page navigation. No live Jira access."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
import os

spec = importlib.util.spec_from_file_location("jira_login", Path(__file__).with_name("jira-login.py"))
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class LoginNavigationTests(unittest.TestCase):
    def setUp(self):
        class Browser:
            def open_tab(self, url):
                return url
        self.cdp = SimpleNamespace(
            CdpBrowser=Browser,
            origin_of=lambda url: "https://" + url.split("/")[2],
            browser_launch_args=lambda *args, **kwargs: ["chrome.exe", "--remote-debugging-address=127.0.0.1"]
        )
        adapter.install_login_navigation(self.cdp, "https://jira-mx.sec.samsung.net")

    def test_browser_startup_has_login_url_before_cdp_handshake(self):
        args = self.cdp.browser_launch_args("chrome.exe", 1234, "profile", False)
        self.assertEqual(args[-1], "https://jira-mx.sec.samsung.net/login.jsp")
        self.assertIn("--remote-debugging-address=127.0.0.1", args)

    def test_new_jira_tab_opens_login_instead_of_anonymous_homepage(self):
        self.assertEqual(self.cdp.CdpBrowser().open_tab("https://jira-mx.sec.samsung.net"),
                         "https://jira-mx.sec.samsung.net/login.jsp")

    def test_does_not_rewrite_existing_sso_destinations(self):
        url = "https://sso.example.test/sign-in"
        self.assertEqual(self.cdp.CdpBrowser().open_tab(url), url)

    def test_read_commands_cannot_use_login_adapter(self):
        with self.assertRaises(ValueError):
            adapter.main(["atlassian.py", "status"])

    def test_preserves_configured_context_path(self):
        adapter.install_login_navigation(self.cdp, "https://jira-mx.sec.samsung.net/jira/")
        self.assertEqual(self.cdp.browser_launch_args()[-1], "https://jira-mx.sec.samsung.net/jira/login.jsp")



@unittest.skipUnless(os.environ.get("JIRA_LOGIN_BROWSER_TEST") == "1", "Set JIRA_LOGIN_BROWSER_TEST=1 for an isolated real-browser test")
class RealBrowserNavigationTests(unittest.TestCase):
    def test_startup_and_new_tab_both_load_login_page(self):
        import http.server
        import tempfile
        import threading
        import sys
        import time
        skill = Path(os.environ.get("MANAGING_JIRA_SKILL_PATH", str(Path.home()/".agents"/"skills"/"managing-jira")))
        sys.path.insert(0, str(skill/"scripts"))
        from engine import cdp_browser as cdp
        requested = threading.Event()
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/login.jsp":
                    requested.set()
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.end_headers()
                self.wfile.write(b"<html><title>Local login fixture</title>Login fixture</html>")
            def log_message(self, *args):
                pass
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        origin = "http://127.0.0.1:" + str(server.server_port)
        original_args, original_open = cdp.browser_launch_args, cdp.CdpBrowser.open_tab
        adapter.install_login_navigation(cdp, origin)
        browser = None
        try:
            with tempfile.TemporaryDirectory(prefix="jira-login-test-") as profile:
                browser = cdp.CdpBrowser(profile, headless=True)
                try:
                    browser.launch()
                    self.assertTrue(requested.wait(10), "Browser startup never requested /login.jsp")
                    requested.clear()
                    target = browser.open_tab(origin)
                    browser._wait_tab_ready(target)
                    self.assertTrue(requested.wait(10), "Fresh Jira tab never requested /login.jsp")
                    self.assertEqual(browser._tab_url(target), origin + "/login.jsp")
                finally:
                    # This closes only the temporary test browser, never the user's managed session.
                    browser.close()
                    if browser._proc:
                        browser._proc.wait(timeout=10)
                    time.sleep(1)
        finally:
            cdp.browser_launch_args, cdp.CdpBrowser.open_tab = original_args, original_open
            server.shutdown()
            server.server_close()

if __name__ == "__main__":
    unittest.main()
