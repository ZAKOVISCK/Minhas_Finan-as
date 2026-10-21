"""Run the independent offline-emulation probe without application code.

This diagnostic is separate from application scenario counts. Each engine gets
a disposable browser and loopback server. No production origin or user profile
is accessed. Requires the pinned tests/requirements-browser.txt dependencies.
"""

import importlib.util
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    spec = importlib.util.spec_from_file_location(
        "compat_checks", Path(__file__).with_name("compat.browser.py")
    )
    compat = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(compat)
    outcomes = []
    with sync_playwright() as playwright:
        for engine in ("chromium", "firefox", "webkit"):
            browser = None
            outcome = {"engine": engine, "containsApplicationCode": False}
            try:
                browser = getattr(playwright, engine).launch()
                outcome["browserVersion"] = browser.version
                probe = compat.offline_driver_probe(browser)
                outcome.update(probe)
                outcome["passed"] = not probe["independentProbeFailed"]
            except Exception as error:
                outcome.update({"passed": False, "error": str(error)})
            finally:
                if browser:
                    browser.close()
            outcomes.append(outcome)
    report = {"diagnostic": "offline-driver-only", "engines": outcomes}
    report["passed"] = all(outcome["passed"] for outcome in outcomes)
    print(json.dumps(report, ensure_ascii=False))
    raise SystemExit(0 if report["passed"] else 1)


if __name__ == "__main__":
    main()
