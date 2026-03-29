"""Playwright-based dashboard screenshare loop.

Opens the dashboard in a headless Chromium browser, takes JPEG screenshots
at ~5fps, and pushes each frame to Recall.ai as the bot's screenshare.

No virtual display (Xvfb) is needed — Playwright headless mode handles
rendering entirely in-process.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging

from playwright.async_api import async_playwright

from config import settings
from meeting.recall_client import BotCompletedError, RecallClient

logger = logging.getLogger(__name__)

_FRAME_INTERVAL = 0.2  # seconds between frames → 5fps
_JPEG_QUALITY = 85
_VIEWPORT = {"width": 1280, "height": 1080}


def _bot_fetch_intercept_script(present_session_id: str) -> str:
    """Return a JS snippet that patches fetch() to inject X-Bot-Session on all API calls.

    The backend's get_current_user() accepts X-Bot-Session as a bot bypass —
    it looks up the session in Redis and returns the tenant_id without Supabase auth.
    This sidesteps the need for a real Supabase user session in the headless browser.
    """
    return f"""
(function() {{
  const _origFetch = window.fetch;
  window.fetch = function(input, init) {{
    init = init || {{}};
    init.headers = Object.assign({{'x-bot-session': {json.dumps(present_session_id)}}}, init.headers || {{}});
    return _origFetch.call(this, input, init);
  }};
}})();
"""


async def run_screenshare_loop(
    dashboard_url: str,
    bot_id: str,
    recall: RecallClient,
    stop_event: asyncio.Event,
    dashboard_ready: asyncio.Event | None = None,
    present_session_id: str = "",
) -> None:
    """Continuously push dashboard screenshots to Recall.ai until stop_event is set."""
    logger.info("Starting screenshare loop for bot %s → %s", bot_id, dashboard_url)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        try:
            context = await browser.new_context(viewport=_VIEWPORT)
            page = await context.new_page()
            # Patch fetch() to inject X-Bot-Session on all API calls so the backend
            # can authenticate the bot without a real Supabase user session.
            if present_session_id:
                await page.add_init_script(_bot_fetch_intercept_script(present_session_id))
            # Force light mode: next-themes reads localStorage key 'theme' at hydration.
            # Setting it to 'light' before React mounts ensures ThemeProvider applies light mode.
            # Also pre-set the class so there's no flash of dark on initial paint.
            await page.add_init_script(
                """
localStorage.setItem('theme', 'light');
document.documentElement.classList.remove('dark');
document.documentElement.classList.add('light');
document.documentElement.style.colorScheme = 'light';
document.documentElement.style.setProperty('--animation-duration', '0s');
"""
            )
            await page.goto(dashboard_url, wait_until="domcontentloaded")
            logger.info("Bot browser landed on: %s", page.url)

            # Wait for chart card divs to appear in the DOM
            try:
                await page.wait_for_selector(".echarts-instance", timeout=30_000)
            except Exception:
                logger.warning("Bot browser: .echarts-instance not found, final URL: %s", page.url)
                await page.wait_for_load_state("networkidle")

            # Wait for ECharts canvases to be initialised inside the cards.
            # echarts.init() is async (dynamic import), so the canvas elements
            # appear slightly after the wrapper divs.
            try:
                await page.wait_for_selector(".echarts-instance canvas", timeout=15_000)
            except Exception:
                logger.warning("Bot browser: ECharts canvas not found — charts may render blank")

            # Small extra settle time for ECharts to finish drawing
            await asyncio.sleep(1.5)

            logger.info("Dashboard rendered — starting frame push")
            if dashboard_ready is not None:
                dashboard_ready.set()

            consecutive_bot_done = 0
            while not stop_event.is_set():
                try:
                    screenshot_bytes = await page.screenshot(
                        type="jpeg",
                        quality=_JPEG_QUALITY,
                        full_page=False,
                    )
                    frame_b64 = base64.b64encode(screenshot_bytes).decode()
                    await recall.output_screenshare_frame(bot_id, frame_b64)
                    consecutive_bot_done = 0
                except BotCompletedError:
                    # Recall.ai reports the bot has left the meeting — stop the loop
                    consecutive_bot_done += 1
                    if consecutive_bot_done >= 2:
                        logger.info("Bot %s has completed — ending screenshare loop", bot_id)
                        stop_event.set()
                        break
                except Exception as exc:
                    logger.warning("Frame push error: %s", exc)

                await asyncio.sleep(_FRAME_INTERVAL)

        finally:
            await context.close()
            await browser.close()

    logger.info("Screenshare loop stopped for bot %s", bot_id)
