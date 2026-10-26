"""Project-local login compatibility fix for managing-jira.

Open the configured login page immediately, including before CDP is ready.
Only this login process is patched; the installed skill and read commands are unchanged.
"""
import json
from pathlib import Path
import runpy
import sys


def install_login_navigation(cdp, base_url):
    login_url = base_url.rstrip("/") + "/login.jsp"
    origin = cdp.origin_of(base_url)
    original_launch_args = cdp.browser_launch_args
    original_open_tab = cdp.CdpBrowser.open_tab

    def launch_args(*args, **kwargs):
        # A visible browser must have a destination even if CDP startup is slow.
        return [*original_launch_args(*args, **kwargs), login_url]

    def open_tab(browser, url):
        # A fresh/recreated Jira tab should start authentication directly.
        # Existing tabs are still reused by managing-jira, preserving active SSO.
        return original_open_tab(browser, login_url if url == origin else url)

    cdp.browser_launch_args = launch_args
    cdp.CdpBrowser.open_tab = open_tab


def main(argv):
    if len(argv) < 2 or argv[1] != "login":
        raise ValueError("This adapter only supports the managing-jira login command.")
    script = Path(argv[0]).resolve(strict=True)
    args = argv[1:]
    if "--site" not in args or args.index("--site") + 1 >= len(args):
        raise ValueError("An explicit Jira site is required.")
    site = args[args.index("--site") + 1]
    config = json.loads((script.parent / "config" / "sites.json").read_text(encoding="utf-8"))
    base_url = config.get("jira", {}).get(site)
    if not isinstance(base_url, str) or not base_url.startswith("https://"):
        raise ValueError("The Jira site must have a configured HTTPS URL.")
    sys.path.insert(0, str(script.parent))
    from engine import cdp_browser
    install_login_navigation(cdp_browser, base_url)
    sys.argv = [str(script), *args]
    runpy.run_path(str(script), run_name="__main__")


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except (ValueError, OSError, KeyError) as error:
        print(json.dumps({"error": str(error), "hint": "Check the managing-jira skill installation and configured site."}), file=sys.stderr)
        sys.exit(1)
