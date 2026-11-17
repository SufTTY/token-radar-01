"""Regenerate the three judge-facing screenshots from the built dashboard.

Runs headless chromium against out/dashboard over a local static server (the dashboard itself is
offline: no request leaves the page). Three 1440x900 shots: the board top, one protocol's detail
drawer, and the alerts panel with the model explanation.

    python tools/screenshots.py            # writes screenshots/1-board.png ...
"""
import http.server
import os
import socketserver
import sys
import threading
from functools import partial

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "out")
DEST = os.path.join(ROOT, "screenshots")
PORT = 8799


def serve():
    handler = partial(http.server.SimpleHTTPRequestHandler, directory=OUT)
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def main():
    os.makedirs(DEST, exist_ok=True)
    httpd = serve()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
            page.goto(f"http://127.0.0.1:{PORT}/dashboard/index.html")
            page.wait_for_selector("table tbody tr", timeout=15000)
            page.wait_for_timeout(400)

            page.screenshot(path=os.path.join(DEST, "1-board.png"))

            page.click("table tbody tr:first-child")
            page.wait_for_selector("dialog[open] .detail-head h2", timeout=10000)
            page.wait_for_timeout(400)
            page.screenshot(path=os.path.join(DEST, "2-detail.png"))
            page.click("dialog .close")
            page.wait_for_timeout(300)

            page.evaluate("document.querySelector('.scatter').scrollIntoView({block:'start'})")
            page.evaluate("window.scrollBy(0, -70)")
            page.wait_for_timeout(400)
            page.screenshot(path=os.path.join(DEST, "3-chart.png"))

            page.evaluate("document.querySelector('.alerts').scrollIntoView({block:'start'})")
            page.evaluate("window.scrollBy(0, -70)")
            page.wait_for_timeout(400)
            page.screenshot(path=os.path.join(DEST, "4-alerts-model.png"))
            browser.close()
    finally:
        httpd.shutdown()

    for name in sorted(os.listdir(DEST)):
        path = os.path.join(DEST, name)
        print(f"{name}: {os.path.getsize(path) // 1024} KiB")


if __name__ == "__main__":
    sys.exit(main())
