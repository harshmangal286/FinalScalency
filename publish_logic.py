# draft_publish_function.py
import asyncio
import json
import os
from playwright.async_api import async_playwright
import logging
from functools import wraps
import random
from typing import Callable, Any
import time
import re

# ✅ NEW: Import Pillow for placeholder image generation and color detection
try:
    from PIL import Image, ImageEnhance, ImageDraw, ImageFont
except ImportError:
    Image = None
    ImageEnhance = None
    ImageDraw = None
    ImageFont = None
    logging.warning("Pillow not installed. Placeholder image generation and image color detection will be unavailable.")

# ✅ NEW: ImageProcessor class for image optimization and placeholder generation
class ImageProcessor:
    @staticmethod
    def optimize_for_vinted(image_path: str, output_path: str = None) -> str:
        """Optimize image for Vinted (resize, compress, enhance)"""
        if not Image:
            raise ImportError("Pillow not installed. Cannot optimize images.")
        
        if not output_path:
            base, ext = os.path.splitext(image_path)
            output_path = f"{base}_optimized{ext}"
        
        img = Image.open(image_path)
        
        # Resize if too large (Vinted max ~8MB, 1920x1920 recommended)
        max_size = (1920, 1920)
        img.thumbnail(max_size, Image.Resampling.LANCZOS)
        
        # Enhance contrast slightly for better visibility
        enhancer = ImageEnhance.Contrast(img)
        img = enhancer.enhance(1.1)
        
        # Save optimized
        img.save(output_path, 'JPEG', quality=85, optimize=True)
        logging.info(f"✅ Image optimized: {output_path}")
        return output_path
    
    @staticmethod
    def create_placeholder_with_text(text: str, output_path: str = "placeholder.jpg") -> str:
        """Create placeholder with item name overlay"""
        if not Image or not ImageDraw or not ImageFont:
            raise ImportError("Pillow not installed. Cannot create placeholder images.")
        
        img = Image.new('RGB', (1200, 1200), color=(240, 240, 240))
        draw = ImageDraw.Draw(img)
        
        # Add text (item title)
        try:
            font = ImageFont.truetype("arial.ttf", 60)
        except Exception:
            try:
                font = ImageFont.load_default()
            except Exception:
                # If even default font fails, skip text
                img.save(output_path, 'JPEG')
                logging.warning("Could not load font; placeholder created without text")
                return output_path
        
        # Calculate text position (centered)
        bbox = draw.textbbox((0, 0), text, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        
        x = (1200 - text_width) / 2
        y = (1200 - text_height) / 2
        
        draw.text((x, y), text, fill=(100, 100, 100), font=font)
        img.save(output_path, 'JPEG', quality=90)
        logging.info(f"✅ Placeholder with text created: {output_path}")
        return output_path

# --- Setup Logging ---
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("vinted_bot")

# Feature flags (all opt-in except remove_dom_aggressively)
FEATURES = {
    "use_sell_path": os.getenv("VINTED_USE_SELL_PATH", "0") == "1",               # try "Sell now" path if set to 1
    "remove_dom_aggressively": os.getenv("VINTED_REMOVE_DOM", "1") == "1",        # keep on by default
    "select_type_login": os.getenv("VINTED_SELECT_TYPE_LOGIN", "1") == "1",       # handle select_type in-popup login if set to 1
    "nuke_cookies_on_block": os.getenv("VINTED_NUKE_COOKIES", "1") == "1",  # delete cookies if block unrecoverable
    "simple_flow": os.getenv("VINTED_SIMPLE_FLOW", "1") == "1",             # prefer previous simple flow
}
# Proxy/engine rotation
VINTED_PROXY = os.getenv("VINTED_PROXY")  # optional single proxy: http://user:pass@host:port
VINTED_PROXY_POOL = [p.strip() for p in os.getenv("VINTED_PROXY_POOL", "").split(",") if p.strip()]
VINTED_ENGINE_PRIMARY = os.getenv("VINTED_ENGINE", "chromium").lower()  # chromium or firefox
VINTED_MAX_RETRIES = int(os.getenv("VINTED_MAX_RETRIES", "3"))

# Rate limiting configuration
VINTED_MIN_DELAY = float(os.getenv("VINTED_MIN_DELAY", "2.0"))
VINTED_MAX_DELAY = float(os.getenv("VINTED_MAX_DELAY", "5.0"))
VINTED_REQUEST_INTERVAL = float(os.getenv("VINTED_REQUEST_INTERVAL", "5.0"))

# Wait up to this many seconds for manual CAPTCHA solving after submit
CAPTCHA_MAX_WAIT = int(os.getenv("VINTED_CAPTCHA_WAIT", "120"))

def _random_user_agent():
    """Return a plausible desktop user agent chosen at random."""
    uas = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:117.0) Gecko/20100101 Firefox/117.0",
    ]
    return random.choice(uas)

# Stealth compatibility wrapper: try async, then sync, then JS fallback
try:
	from playwright_stealth import stealth_async as _stealth_async  # type: ignore
	async def apply_stealth(page):
		try:
			await _stealth_async(page)
		except Exception as e:
			logger.debug(f"stealth_async failed: {e}")
except Exception:
	try:
		from playwright_stealth import stealth_sync as _stealth_sync  # type: ignore
		async def apply_stealth(page):
			try:
				_stealth_sync(page)
			except Exception as e:
				logger.debug(f"stealth_sync failed: {e}")
	except Exception:
		async def apply_stealth(page):
			try:
				await page.add_init_script("""
				Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
				Object.defineProperty(navigator, 'languages', {get: () => ['en-US', 'en']});
				Object.defineProperty(navigator, 'platform', {get: () => 'Win32'});
				window.chrome = window.chrome || { runtime: {} };
				Object.defineProperty(navigator, 'maxTouchPoints', {get: () => 0});
				""")
			except Exception as e:
				logger.debug(f"fallback stealth failed: {e}")

# --- New helpers: safe click, remove overlays, region/cookie handling ---
async def _safe_click(page, selector: str, timeout: int = 3000) -> bool:
    """Safely click a selector, with error handling and logging.""" 
    try:
        el = await page.query_selector(selector)
        if el:
            await el.click(timeout=timeout)
            logger.info(f"Clicked selector: {selector}")
            return True
    except Exception as e:
        logger.debug(f"safe_click failed for {selector}: {e}")
    return False

async def _remove_blocking_dom(page) -> None:
    """Remove common blocking elements like cookie banners and modals."""
    # Skip DOM removal if a CAPTCHA/challenge is present to avoid breaking it
    # Use a more conservative check here
    try:
        # Only skip if there's a visible CAPTCHA iframe
        captcha_iframes = await page.query_selector_all('iframe[src*="captcha"], iframe[src*="datadome"]')
        for iframe in captcha_iframes:
            try:
                if await iframe.is_visible():
                    box = await iframe.bounding_box()
                    if box and box.get("width", 0) > 100:
                        logger.info("Visible CAPTCHA iframe detected; skipping overlay removal")
                        return
            except Exception:
                continue
    except Exception:
        pass
    
    try:
        await page.evaluate(""" 
        () => {
          const selectors = [
            '#onetrust-consent-sdk',
            '.onetrust-banner-sdk',
            '[data-testid="cookie-consent"]',
            '.cookie-banner',
            '.cookie-consent',
            '.cookiePopUp', 
            '#cookie-consent',
            '.geolocation-modal',
            '.location-modal',
            '.region-modal',
            '[aria-modal="true"]'
          ];
          selectors.forEach(s => {
            const es = document.querySelectorAll(s);
            es.forEach(e => { try { e.remove(); } catch(e) {} });
          });
          const overlays = document.querySelectorAll('[role="dialog"], .modal, .overlay');
          overlays.forEach(o => { try { o.style.display = "none"; o.remove(); } catch(e){} });
          try {
            document.documentElement.style.overflow = 'auto';
            document.body.style.overflow = 'auto';
          } catch(e){}
        }
        """)
        logger.info("Blocked modal elements removed via JS fallback")
    except Exception as e:
        logger.debug(f"_remove_blocking_dom error: {e}")

# --- New region/cookie handling with caching and enhanced headers ---
async def handle_region_and_cookies(page) -> None:
    """Handle region selection and cookie consent dialogs."""
    cookie_selectors = [
        'button:has-text("Accept all")',
        'button:has-text("Accept All")',
        'button:has-text("Accept")',
        '#onetrust-accept-btn-handler',
        '[data-testid="cookie-accept-all"]',
        'button:has-text("Agree")',
    ]
    uk_texts = ["united kingdom", "uk", "vinted.co.uk"]

    # Cache toggles to avoid repeated clicking on the same page
    try:
        cookie_done = await page.evaluate("() => !!window.__cookies_accepted")
    except Exception:
        cookie_done = False
    try:
        region_done = await page.evaluate("() => !!window.__uk_selected")
    except Exception:
        region_done = False

    for attempt in range(3):
        await page.wait_for_timeout(600 if attempt > 0 else 1200)
        clicked = False

        # UK-specific region selection (only if not already done)
        if not region_done:
            try:
                links = await page.query_selector_all('a.domain-selection-link, a[href*="vinted.co.uk"], a[href*="//www.vinted.co.uk"]')
                for link in links:
                    try:
                        text = ((await link.inner_text()) or "").strip().lower()
                    except Exception:
                        text = ""
                    href = (await link.get_attribute("href")) or ""
                    if any(t in text for t in uk_texts) or "vinted.co.uk" in href:
                        await link.click()
                        await page.evaluate("() => { window.__uk_selected = true; }")
                        logger.info("Selected United Kingdom region via link")
                        await page.wait_for_timeout(800)
                        clicked = True
                        region_done = True
                        break

                if not clicked:
                    for sel in [
                        'button:has-text("Stay on Vinted.co.uk")',
                        'button:has-text("Go to Vinted UK")',
                        'button:has-text("United Kingdom")',
                    ]:
                        el = await page.query_selector(sel)
                        if el:
                            await el.click()
                            await page.evaluate("() => { window.__uk_selected = true; }")
                            logger.info(f"Selected United Kingdom region via {sel}")
                            await page.wait_for_timeout(800)
                            clicked = True
                            region_done = True
                            break
            except Exception:
                pass

        # Cookie consent (only if not already done)
        if not clicked and not cookie_done:
            for sel in cookie_selectors:
                try:
                    el = await page.query_selector(sel)
                    if el:
                        await el.click(timeout=1500)
                        await page.evaluate("() => { window.__cookies_accepted = true; }")
                        logger.info(f"Accepted cookie consent via {sel}")
                        await page.wait_for_timeout(800)
                        clicked = True
                        cookie_done = True
                        break
                except Exception:
                    continue

        if clicked:
            try:
                blocked = await page.query_selector('[role="dialog"], .modal, .overlay, #onetrust-consent-sdk')
                if not blocked:
                    return
            except Exception:
                return

    # Only do aggressive DOM removal if enabled
    if FEATURES["remove_dom_aggressively"]:
        await _remove_blocking_dom(page)
        await page.wait_for_timeout(500)

class StockManager:
    def __init__(self, db_path: str = "stock_inventory.json"):
        self.db_path = db_path
        self._ensure_db()
    
    def _ensure_db(self):
        """Create stock database if it doesn't exist"""
        if not os.path.exists(self.db_path):
            with open(self.db_path, 'w') as f:
                json.dump({"items": {}, "listings": {}}, f, indent=2)
    
    def load_inventory(self) -> dict:
        """Load inventory from JSON database"""
        try:
            with open(self.db_path, 'r') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed to load inventory: {e}")
            return {"items": {}, "listings": {}}
    
    def save_inventory(self, data: dict):
        """Save inventory to JSON database"""
        try:
            with open(self.db_path, 'w') as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save inventory: {e}")
    
    def add_listing(self, item_id: str, listing_data: dict):
        """Add or update a listing in inventory"""
        inventory = self.load_inventory()
        inventory["listings"][item_id] = {
            **listing_data,
            "created_at": time.time(),
            "last_reposted": None,
            "repost_count": 0
        }
        self.save_inventory(inventory)
    
    def update_stock(self, item_id: str, quantity: int):
        """Update stock quantity for an item"""
        inventory = self.load_inventory()
        if item_id in inventory["items"]:
            inventory["items"][item_id]["quantity"] = quantity
        else:
            inventory["items"][item_id] = {"quantity": quantity}
        self.save_inventory(inventory)
    
    def get_stock(self, item_id: str) -> int:
        """Get current stock quantity"""
        inventory = self.load_inventory()
        return inventory["items"].get(item_id, {}).get("quantity", 0)
    
    def mark_as_sold(self, item_id: str):
        """Mark item as sold and decrease stock"""
        inventory = self.load_inventory()
        if item_id in inventory["items"]:
            current = inventory["items"][item_id].get("quantity", 0)
            inventory["items"][item_id]["quantity"] = max(0, current - 1)
        if item_id in inventory["listings"]:
            inventory["listings"][item_id]["status"] = "sold"
        self.save_inventory(inventory)
    
    def get_listings_to_repost(self, hours: int = 24) -> list:
        """Get listings that haven't been reposted in X hours"""
        inventory = self.load_inventory()
        current_time = time.time()
        cutoff = current_time - (hours * 3600)
        
        to_repost = []
        for listing_id, data in inventory["listings"].items():
            last_repost = data.get("last_reposted") or data.get("created_at", 0)
            if last_repost < cutoff and data.get("status") != "sold":
                to_repost.append((listing_id, data))
        
        return to_repost
    
    def update_repost_time(self, item_id: str):
        """Update last repost timestamp"""
        inventory = self.load_inventory()
        if item_id in inventory["listings"]:
            inventory["listings"][item_id]["last_reposted"] = time.time()
            inventory["listings"][item_id]["repost_count"] = inventory["listings"][item_id].get("repost_count", 0) + 1
        self.save_inventory(inventory)

# --- New region/cookie handling with caching and enhanced headers ---
async def handle_region_and_cookies(page) -> None:
    """Handle region selection and cookie consent dialogs."""
    cookie_selectors = [
        'button:has-text("Accept all")',
        'button:has-text("Accept All")',
        'button:has-text("Accept")',
        '#onetrust-accept-btn-handler',
        '[data-testid="cookie-accept-all"]',
        'button:has-text("Agree")',
    ]
    uk_texts = ["united kingdom", "uk", "vinted.co.uk"]

    # Cache toggles to avoid repeated clicking on the same page
    try:
        cookie_done = await page.evaluate("() => !!window.__cookies_accepted")
    except Exception:
        cookie_done = False
    try:
        region_done = await page.evaluate("() => !!window.__uk_selected")
    except Exception:
        region_done = False

    for attempt in range(3):
        await page.wait_for_timeout(600 if attempt > 0 else 1200)
        clicked = False

        # UK-specific region selection (only if not already done)
        if not region_done:
            try:
                links = await page.query_selector_all('a.domain-selection-link, a[href*="vinted.co.uk"], a[href*="//www.vinted.co.uk"]')
                for link in links:
                    try:
                        text = ((await link.inner_text()) or "").strip().lower()
                    except Exception:
                        text = ""
                    href = (await link.get_attribute("href")) or ""
                    if any(t in text for t in uk_texts) or "vinted.co.uk" in href:
                        await link.click()
                        await page.evaluate("() => { window.__uk_selected = true; }")
                        logger.info("Selected United Kingdom region via link")
                        await page.wait_for_timeout(800)
                        clicked = True
                        region_done = True
                        break

                if not clicked:
                    for sel in [
                        'button:has-text("Stay on Vinted.co.uk")',
                        'button:has-text("Go to Vinted UK")',
                        'button:has-text("United Kingdom")',
                    ]:
                        el = await page.query_selector(sel)
                        if el:
                            await el.click()
                            await page.evaluate("() => { window.__uk_selected = true; }")
                            logger.info(f"Selected United Kingdom region via {sel}")
                            await page.wait_for_timeout(800)
                            clicked = True
                            region_done = True
                            break
            except Exception:
                pass

        # Cookie consent (only if not already done)
        if not clicked and not cookie_done:
            for sel in cookie_selectors:
                try:
                    el = await page.query_selector(sel)
                    if el:
                        await el.click(timeout=1500)
                        await page.evaluate("() => { window.__cookies_accepted = true; }")
                        logger.info(f"Accepted cookie consent via {sel}")
                        await page.wait_for_timeout(800)
                        clicked = True
                        cookie_done = True
                        break
                except Exception:
                    continue

        if clicked:
            try:
                blocked = await page.query_selector('[role="dialog"], .modal, .overlay, #onetrust-consent-sdk')
                if not blocked:
                    return
            except Exception:
                return

    # Only do aggressive DOM removal if enabled
    if FEATURES["remove_dom_aggressively"]:
        await _remove_blocking_dom(page)
        await page.wait_for_timeout(500)

class VintedBot:
    def __init__(self, account_id: str, username: str, password: str, domain: str = "vinted.co.uk"):
        self.account_id = account_id
        self.username = username
        self.password = password
        self.domain = domain
        self.cookies_path = f"cookies/cookies_{account_id}.json"
        os.makedirs("cookies", exist_ok=True)
        self._blocked_recently = False  # track unrecoverable block state
        self._headful = False
        self._diag_count = 0
        self._last_request_time = 0
        self._min_request_interval = VINTED_REQUEST_INTERVAL  # Minimum seconds between requests

        # Fields added for auto-detection / overrides
        self.category: str | None = None
        self.brand: str | None = None
        self.color: str | None = None
        self.material: str | None = None
        self.size: str | None = None
        self.condition: str | None = None

        # ✅ NEW: Stock management
        self.stock_manager = StockManager(f"stock_{account_id}.json")

    async def _rate_limit(self):
        """Enforce rate limiting between requests"""
        now = time.time()
        elapsed = now - self._last_request_time
        if elapsed < self._min_request_interval:
            wait_time = self._min_request_interval - elapsed
            logger.info(f"⏳ Rate limiting: waiting {wait_time:.1f}s")
            await asyncio.sleep(wait_time)
        self._last_request_time = time.time()
    
    async def _smart_wait(self, min_delay=2, max_delay=5):
        """Randomized delay between actions"""
        delay = random.uniform(min_delay, max_delay)
        logger.debug(f"Smart wait: {delay:.1f}s")
        await asyncio.sleep(delay)

    # --- Block detection and recovery ---
    async def _is_blocked_page(self, page) -> bool:
        """Detect Vinted 'Your session has been blocked' or similar challenge pages."""
        try:
            url = (page.url or "").lower()
            if any(x in url for x in ["session-refresh", "session_refresh", "/cdn-cgi/"]):
                return True
            html = (await page.content()).lower()
            markers = [
                "your session has been blocked",
                "unusual activity",
                "temporarily blocked your access",
                "we're sorry for the inconvenience",
            ]
            return any(m in html for m in markers)
        except Exception:
            return False

    async def _recover_from_block(self, page) -> bool:
        """Lightweight recovery: reload, robots.txt detour, clear storage/cookies, return home."""
        try:
            logger.warning("Detected block page; attempting recovery...")
            # Quick reload
            try:
                await page.wait_for_timeout(1200)
                await page.reload(timeout=10000)
            except Exception:
                pass
            if not await self._is_blocked_page(page):
                return True

            # Clear storage first (keep cookies for now)
            try:
                await page.evaluate("() => { localStorage.clear(); sessionStorage.clear(); }")
            except Exception:
                pass

            # Robots.txt detour
            try:
                await page.goto(f"https://www.{self.domain}/robots.txt", timeout=8000)
                await page.wait_for_timeout(500)
            except Exception:
                pass

            # Back home
            try:
                await page.goto(f"https://www.{self.domain}/", timeout=10000)
                await page.wait_for_timeout(800)
            except Exception:
                pass

            await handle_region_and_cookies(page)

            if not await self._is_blocked_page(page):
                return True

            # Last resort: clear cookies as well
            try:
                await page.context.clear_cookies()
            except Exception:
                pass
            try:
                await page.goto(f"https://www.{self.domain}/", timeout=10000)
                await page.wait_for_timeout(800)
            except Exception:
                pass

            await handle_region_and_cookies(page)
            return not await self._is_blocked_page(page)
        except Exception:
            return False

    async def _save_cookies(self, context):
        cookies = await context.cookies()
        with open(self.cookies_path, "w", encoding="utf-8") as f:
            json.dump(cookies, f, indent=2)
        logger.info(f"✅ Saved cookies to {self.cookies_path}")

    async def _load_cookies(self, context):
        if os.path.exists(self.cookies_path):
            with open(self.cookies_path, "r", encoding="utf-8") as f:
                cookies = json.load(f)
            await context.add_cookies(cookies)
            logger.info(f"✅ Loaded {len(cookies)} cookies from {self.cookies_path}")

    async def _open_email_login(self, page) -> bool:
        """
        Ensure the email-login view is opened. Handles the 'Already have an account? Log in' switch,
        then clicks the 'Log in with email' / 'Continue with Email' button within the same popup.
        Improved to handle hidden/delayed elements and popups and avoid Google login.
        """
        try:
            # Wait a bit for any popups to stabilize
            await page.wait_for_timeout(800)
            
            # Try direct email login button first (more specific selectors)
            email_login_selectors = [
                '[data-testid="auth-select-type--login-email"]',
                'button:has-text("Log in with email"):not(:has-text("Google"))',
                'button:has-text("Continue with Email"):not(:has-text("Google"))',
                'a:has-text("Log in with email"):not(:has-text("Google"))',
                # Specifically avoid Google buttons
                'button[type="button"]:has-text("email"):not(:has-text("Google")):not(:has-text("Facebook"))',
            ]
            
            for sel in email_login_selectors:
                try:
                    btn = await page.query_selector(sel)
                    if btn:
                        # Double-check it's not a Google/social login button
                        try:
                            btn_text = (await btn.inner_text()).lower()
                            if 'google' in btn_text or 'facebook' in btn_text or 'apple' in btn_text:
                                logger.debug(f"Skipping social login button: {btn_text}")
                                continue
                        except Exception:
                            pass
                        
                        try:
                            await btn.scroll_into_view_if_needed()
                        except Exception:
                            pass
                        await btn.click(timeout=2000)
                        logger.info(f"Selected 'Log in with email' via: {sel}")
                        await page.wait_for_timeout(600)
                        
                        try:
                            await page.wait_for_selector('[data-testid="email-login-view"], #username, input[name="username"]', timeout=5000)
                            return True
                        except Exception:
                            pass
                except Exception as e:
                    logger.debug(f"Selector {sel} failed: {e}")
                    continue
            
            # Look for register view and switch to login
            try:
                reg_view = await page.query_selector('[data-testid="select-type-register-view"]')
                if reg_view:
                    switch = await page.query_selector('[data-testid="auth-select-type--register-switch"]')
                    if switch:
                        try:
                            await switch.click()
                            logger.info("Clicked 'Already have an account? Log in' switch")
                            await page.wait_for_timeout(800)
                            
                            # Now try email login selectors again after switching
                            for sel in email_login_selectors:
                                try:
                                    btn = await page.query_selector(sel)
                                    if btn:
                                        btn_text = (await btn.inner_text()).lower()
                                        if 'google' in btn_text or 'facebook' in btn_text or 'apple' in btn_text:
                                            continue
                                        await btn.click(timeout=2000)
                                        logger.info(f"Selected email login after switch via: {sel}")
                                        await page.wait_for_timeout(600)
                                        try:
                                            await page.wait_for_selector('[data-testid="email-login-view"], #username, input[name="username"]', timeout=5000)
                                            return True
                                        except Exception:
                                            pass
                                except Exception:
                                    continue
                        except Exception as e:
                            logger.debug(f"Switch click failed: {e}")
            except Exception:
                pass
            
            # Try to find and click email option more aggressively, filtering out social logins
            for attempt in range(4):
                # Get all buttons
                try:
                    all_buttons = await page.query_selector_all('button, a')
                    for btn in all_buttons:
                        try:
                            text = (await btn.inner_text()).strip().lower()
                            # Must contain 'email' and NOT contain social login keywords
                            if 'email' in text and not any(social in text for social in ['google', 'facebook', 'apple', 'twitter']):
                                if any(keyword in text for keyword in ['log in', 'login', 'continue', 'sign in']):
                                    try:
                                        await btn.scroll_into_view_if_needed()
                                    except Exception:
                                        pass
                                    await btn.click(timeout=2000)
                                    logger.info(f"Clicked email login button with text: {text}")
                                    await page.wait_for_timeout(600)
                                    try:
                                        await page.wait_for_selector('[data-testid="email-login-view"], #username, input[name="username"]', timeout=4000)
                                        return True
                                    except Exception:
                                        pass
                        except Exception:
                            continue
                except Exception:
                    pass
                
                # Check if form is already visible
                if await page.query_selector('#username, input[name="username"], input[name="email"]'):
                    logger.info("Email login form already visible")
                    return True
                
                if attempt < 3:
                    await page.wait_for_timeout(600)
            
            logger.warning("Could not find or click email login button after multiple attempts")
            return False
        except Exception as e:
            logger.debug(f"_open_email_login error: {e}")
            return False

    async def _fill_login_details(self, page) -> bool:
        """
        Fill login form using selectors from the email-login-view snippet and submit the form.
        """
        user_selectors = ['#username', 'input[name="username"]', 'input[placeholder*="Email or username"]', 'input[name="email"]']
        pw_selectors = ['#password', 'input[name="password"]', 'input[placeholder*="Password"]']
        submit_selectors = ['[data-testid="email-login-view"] button[type="submit"]', 'form button[type="submit"]', 'button:has-text("Continue")']
        try:
            await page.wait_for_selector('#username, input[name="username"], input[name="email"]', timeout=5000)
        except Exception:
            pass
        filled_user = False
        for sel in user_selectors:
            try:
                el = await page.query_selector(sel)
                if el:
                    await el.fill(self.username)
                    logger.info(f"Filled username via {sel}")
                    filled_user = True
                    break
            except Exception:
                continue
        filled_pw = False
        for sel in pw_selectors:
            try:
                el = await page.query_selector(sel)
                if el:
                    await el.fill(self.password)
                    logger.info(f"Filled password via {sel}")
                    filled_pw = True
                    break
            except Exception:
                continue
        if not (filled_user and filled_pw):
            return False
        for sel in submit_selectors:
            try:
                btn = await page.query_selector(sel)
                if btn:
                    await btn.click()
                    logger.info(f"Clicked submit via {sel}")
                    return True
            except Exception:
                continue
        return False

    async def _open_login_via_sell(self, page) -> bool:
        """
        Click 'Sell now' to open auth popup. If redirected to /items/new, user is already logged in.
        Otherwise, click the register switch and then 'Log in with email'.
        """
        try:
            await page.goto(f"https://www.{self.domain}")
            await handle_region_and_cookies(page)
            for sel in [
                'a[data-testid="header--sell-button"]',
                'a:has-text("Sell now")',
                'button:has-text("Sell")',
                'a[href*="/items/new"]'
            ]:
                if await _safe_click(page, sel, timeout=3000):
                    await page.wait_for_timeout(800)
                    break
            if "/items/new" in (page.url or ""):
                logger.info("Sell clicked, navigated to /items/new; user appears logged in")
                return True
            opened = await self._open_email_login(page)
            return opened
        except Exception:
            return False

    async def _handle_select_type_login(self, page) -> bool:
        """
        When redirected to /member/signup/select_type, open the login path in the popup
        and submit credentials. Returns True if login appears successful.
        """
        try:
            await handle_region_and_cookies(page)
            opened = await self._open_email_login(page)
            if not opened:
                logger.warning("Could not reveal email login from select_type view")
                return False  # Changed from continuing to returning False
            if await self._fill_login_details(page):
                # Allow manual CAPTCHA solving and auth propagation
                ok = await self._wait_for_auth_resolution(page)
                if ok:
                    return True
                # If URL changed away from select_type, also treat as success
                if "member/signup/select_type" not in (page.url or ""):
                    return True
                # Inputs gone implies progression as well
                if not await page.query_selector('#username, input[name="username"], input[name="email"]'):
                    return True
            return False
        except Exception as e:
            logger.debug(f"_handle_select_type_login error: {e}")
            return False

    async def _wait_for_auth_resolution(self, page, max_wait: int = 30) -> bool:
        """
        Wait for authentication to complete after login submission.
        Returns True if auth succeeded (URL changed, form disappeared, or reached logged-in page).
        Handles 2FA/verification code prompts.
        """
        logger.info("Waiting for authentication resolution...")
        
        initial_url = page.url or ""
        start_time = asyncio.get_event_loop().time()
        
        while (asyncio.get_event_loop().time() - start_time) < max_wait:
            await asyncio.sleep(1)
            
            current_url = page.url or ""
            
            # Check for 2FA/verification code prompt
            try:
                html = (await page.content()).lower()
                if any(k in html for k in ["verification code", "verify that it's you", "4-digit code", "enter this code", "one-time code"]):
                    logger.warning("🔐 2FA/Verification code required!")
                    logger.warning("Please check your email and enter the code in the browser.")
                    logger.info(f"Waiting up to {max(60, max_wait)} seconds for manual code entry...")
                    
                    # Wait for code to be entered
                    code_wait = max(120, max_wait)  # At least 2 minutes for 2FA
                    code_start = asyncio.get_event_loop().time()
                    
                    while (asyncio.get_event_loop().time() - code_start) < code_wait:
                        await asyncio.sleep(2)
                        current_url = page.url or ""
                        
                        # Check if we've progressed past 2FA
                        if "select_type" not in current_url.lower() or "/items/new" in current_url.lower():
                            logger.info("✅ 2FA appears to have been completed!")
                            await asyncio.sleep(2)
                            return True
                        
                        # Check if verification input is gone
                        try:
                            verification_input = await page.query_selector('input[name="code"], input[placeholder*="code"], input[type="text"][maxlength="4"]')
                            if not verification_input:
                                logger.info("✅ Verification code form disappeared")
                                await asyncio.sleep(2)
                                return True
                        except Exception:
                            pass
                        
                        if int(asyncio.get_event_loop().time() - code_start) % 20 == 0:
                            logger.info(f"Still waiting for 2FA code entry... ({int(asyncio.get_event_loop().time() - code_start)}s elapsed)")
                    
                    logger.warning("⚠️ 2FA code entry timeout")
                    return False
            except Exception:
                pass
            
            # Success indicators
            # 1. URL changed away from login/signup pages (but NOT to select_type)
            if current_url != initial_url:
                # Exclude select_type from success - it's still part of auth flow
                if not any(x in current_url.lower() for x in ["login", "signup", "select_type", "auth", "verify"]):
                    logger.info(f"✅ Auth resolved: navigated to {current_url}")
                    return True
            
            # 2. Reached a logged-in page (but NOT select_type)
            if "/items/new" in current_url.lower() or "/dashboard" in current_url.lower():
                logger.info(f"✅ Auth resolved: reached logged-in page {current_url}")
                return True
            
            # Check for member pages, but exclude select_type
            if "/member/" in current_url.lower() and "select_type" not in current_url.lower():
                logger.info(f"✅ Auth resolved: reached member page {current_url}")
                return True
            
            # 3. Login form disappeared and we're not still on select_type
            try:
                login_form = await page.query_selector('#username, input[name="username"], input[name="email"]')
                if not login_form and "select_type" not in current_url.lower():
                    # Form is gone and not on select_type, likely progressed
                    logger.info("✅ Auth resolved: login form disappeared")
                    return True
            except Exception:
                pass
            
            # 4. Check for error messages (failed auth) - but NOT 2FA prompts
            try:
                error_texts = ["incorrect password", "invalid credentials", "wrong password", "authentication failed"]
                html = (await page.content()).lower()
                # Exclude 2FA-related text from error detection
                if not any(k in html for k in ["verification code", "verify that it's you", "4-digit code", "enter this code"]):
                    if any(err in html for err in error_texts):
                        logger.warning("⚠️ Login error detected in page content")
                        return False
            except Exception:
                pass
            
            # 5. Check for CAPTCHA - if present, wait for it
            if await self._is_captcha_present(page):
                logger.info("CAPTCHA detected during auth; waiting for solve...")
                solved = await self._wait_for_captcha_solve(page, max_wait=max(60, max_wait))
                if solved:
                    continue
                else:
                    logger.warning("CAPTCHA not solved; auth may have failed")
                    return False
        
        logger.warning(f"⚠️ Auth resolution timeout after {max_wait}s")
        # Even if we timeout, if we're not on an error page, treat as partial success
        current_url = page.url or ""
        if "error" not in current_url.lower() and "login" not in current_url.lower():
            logger.info("Timeout reached but no error detected; treating as success")
            return True
        return False

    async def _ensure_listing_form(self, page) -> bool:
        """
        Ensure we are on the listing form. Keep previous working path; optional flows are gated by FEATURES.
        """
        async def _has_title_field(timeout: int = 12000) -> bool:
            try:
                sel = 'input[name="title"], input[placeholder*="itle"], textarea[name="title"], textarea[placeholder*="itle"]'
                await page.wait_for_selector(sel, timeout=timeout)
                return True
            except Exception:
                return False

        # Start with the previous working path only
        strategies = [
            ("direct-new", f"https://www.{self.domain}/items/new"),
        ]
        # Add optional paths only if explicitly enabled
        if FEATURES["use_sell_path"]:
            strategies.extend([
                ("sell-button", None),
                ("direct-new-src", f"https://www.{self.domain}/items/new?source=header_sell"),
            ])

        for name, url in strategies:
            try:
                if url:
                    await page.goto(url, wait_until="domcontentloaded")
                    await handle_region_and_cookies(page)
                else:
                    await page.goto(f"https://www.{self.domain}")
                    await handle_region_and_cookies(page)
                    for sel in [
                        'a[data-testid="header--sell-button"]',
                        'a[href*="/items/new"]',
                        'a:has-text("Sell now")',
                        'button:has-text("Sell")',
                    ]:
                        if await _safe_click(page, sel, timeout=3000):
                            await page.wait_for_timeout(1200)
                            break

                # Handle select_type redirect only if enabled
                if FEATURES["select_type_login"] and "member/signup/select_type" in (page.url or ""):
                    logger.info("Redirected to signup/select_type; attempting in-popup login (opt-in)")
                    if await self._handle_select_type_login(page):
                        await page.goto(f"https://www.{self.domain}/items/new", wait_until="domcontentloaded")
                        await handle_region_and_cookies(page)
                        if FEATURES["remove_dom_aggressively"]:
                            await _remove_blocking_dom(page)

                if FEATURES["remove_dom_aggressively"]:
                    await _remove_blocking_dom(page)
                await handle_region_and_cookies(page)

                if await _has_title_field(timeout=15000):
                    return True
            except Exception:
                continue

        # Final attempt: conservative reload
        try:
            await page.reload(wait_until="domcontentloaded", timeout=10000)
        except Exception:
            pass
        await handle_region_and_cookies(page)
        if FEATURES["remove_dom_aggressively"]:
            await _remove_blocking_dom(page)
        return await _has_title_field(timeout=8000)

    async def login(self, page):
        logger.info("🔐 Logging into Vinted...")
        await page.goto(f"https://www.{self.domain}")
        await handle_region_and_cookies(page)

        # If blocked at entry, try recovery
        if await self._is_blocked_page(page):
            ok = await self._recover_from_block(page)
            if not ok:
                logger.error("Unable to recover from block on homepage")
                return False

        try:
            sell_opened = False
            if FEATURES["use_sell_path"]:
                sell_opened = await self._open_login_via_sell(page)
                if sell_opened and "/items/new" in (page.url or ""):
                    logger.info("✅ Already logged in (sell flow reached /items/new).")
                    return True

            if not sell_opened:
                # fallback to header login button
                await page.wait_for_selector('[data-testid="header--login-button"]', timeout=15000)
                await page.click('[data-testid="header--login-button"]')
                logger.info("Clicked login button on homepage")
                opened = await self._open_email_login(page)
                if not opened:
                    logger.warning("Email login view not opened; attempting direct field fill")

            # Ensure email login form is visible then fill
            try:
                await page.wait_for_selector('[data-testid="email-login-view"], #username, input[name="username"], input[name="email"]', timeout=8000)
            except Exception:
                pass

            if not await self._fill_login_details(page):
                # fallback selectors
                try:
                    await page.wait_for_selector('input[name="email"], input#username', timeout=15000)
                    await page.fill('input[name="email"], input#username', self.username)
                    await page.fill('input[name="password"], input#password', self.password)
                    for sel in ('button[type="submit"]:has-text("Continue")',
                                'button[type="submit"]:has-text("Log in")',
                                'button[type="submit"]'):
                        if await page.query_selector(sel):
                            await page.click(sel)
                            logger.info(f"Clicked submit selector: {sel}")
                            break
                except Exception as e:
                    logger.error(f"Login fill fallback failed: {e}")
                    return False

            await handle_region_and_cookies(page)

            # Wait for CAPTCHA/auth resolution instead of retrying immediately
            if await self._wait_for_auth_resolution(page):
                return True

            # Success heuristic (secondary)
            if "/member/" in (page.url or ""):
                logger.info("✅ Login successful.")
                return True
            await page.goto(f"https://www.{self.domain}/member/{self.account_id}")
            if f"/member/{self.account_id}" in (page.url or ""):
                logger.info("✅ Login successful (verified via profile).")
                return True

            logger.error("❌ Login failed. Check credentials or CAPTCHA.")
            return False
        except Exception as e:
            logger.error(f"❌ Login flow error: {e}")
            return False

    async def ensure_logged_in(self, context, page, use_cookies: bool = True):
        """
        Ensure we're logged in. If use_cookies=False (persistent profile mode),
        skip aggressive checks and assume the profile is pre-authenticated.
        """
        if use_cookies:
            await self._load_cookies(context)
        else:
            logger.info("Skipping cookie load (persistent profile mode)")

        await page.goto(f"https://www.{self.domain}", wait_until="domcontentloaded")
        await handle_region_and_cookies(page)

        # If using persistent profile, skip block detection on homepage
        # (profile should already be authenticated or will auto-login via sessions)
        if use_cookies:
            # Cookie mode: check for hard block
            if await self._is_blocked_page(page):
                ok = await self._handle_hard_block(context, page)
                if not ok:
                    return False

            # In simple flow, skip aggressive block detection
            if not FEATURES.get("simple_flow", False):
                if await self._is_blocked_page(page):
                    ok = await self._recover_from_block(page)
                    if not ok:
                        logger.error("Blocked after loading cookies; cannot recover")
                        self._blocked_recently = True
                        if FEATURES["nuke_cookies_on_block"] and os.path.exists(self.cookies_path):
                            try:
                                os.remove(self.cookies_path)
                                logger.info(f"🧹 Deleted blocked cookies file: {self.cookies_path}")
                            except Exception:
                                pass
                        return False
            self._blocked_recently = False

        # Try to reach member page to check if already logged in
        try:
            await page.goto(f"https://www.{self.domain}/member/{self.account_id}", wait_until="domcontentloaded", timeout=10000)
            
            # If block detected at member page, handle it
            if await self._is_blocked_page(page):
                if use_cookies:
                    ok = await self._handle_hard_block(context, page)
                    if not ok:
                        return False
                else:
                    # Persistent profile: try lightweight recovery without aggressive block handling
                    logger.warning("Block detected on member page; attempting lightweight recovery...")
                    ok = await self._recover_from_block(page)
                    if not ok:
                        logger.warning("Could not recover; will attempt login")
                        # Don't fail here; try login as fallback
        except Exception as e:
            logger.debug(f"Error reaching member page: {e}")

        # Check if we are logged in via HTML content
        try:
            html = (await page.content()).lower()
            if "your account" in html or "welcome back" in html or "my profile" in html:
                logger.info("✅ Already logged in via persistent profile.")
                return True
        except Exception:
            pass

        # If not logged in, attempt full login
        logger.info("Not yet logged in; attempting login...")
        success = await self.login(page)
        if success:
            if use_cookies:
                await self._save_cookies(context)
            logger.info("✅ Login successful.")
            return True
        else:
            logger.error("❌ Login failed.")
            return False

    async def _publish_listing_simple(self, page, title, description, price, image_path=None):
        """
        Previous simple flow to reach the form and fill it without complex gating.
        Enhanced with dropdown handling and placeholder image support.
        """
        # Store title for placeholder generation
        self._current_title = title
        
        async def _wait_title_field(timeout: int = 15000) -> bool:
            try:
                sel = 'input[name="title"], input[placeholder*="itle"], textarea[name="title"], textarea[placeholder*="itle"]'
                await page.wait_for_selector(sel, timeout=timeout)
                return True
            except Exception:
                return False

        strategies = [
            ("direct-new", f"https://www.{self.domain}/items/new"),
            ("sell-button", None),
            ("direct-new-src", f"https://www.{self.domain}/items/new?source=header_sell"),
        ]

        for name, url in strategies:
            try:
                # Add rate limiting between strategies
                await self._rate_limit()
                
                logger.info(f"Trying strategy: {name}")
                
                if url:
                    await self._goto_with_retry(page, url, wait_until="domcontentloaded")
                    await self._smart_wait(2, 4)
                    await handle_region_and_cookies(page)
                else:
                    await self._goto_with_retry(page, f"https://www.{self.domain}", wait_until="domcontentloaded")
                    await self._smart_wait(2, 4)
                    await handle_region_and_cookies(page)
                    
                    for sel in [
                        'a[data-testid="header--sell-button"]',
                        'a[href*="/items/new"]',
                        'a:has-text("Sell now")',
                        'button:has-text("Sell")',
                    ]:
                        if await _safe_click(page, sel, timeout=1000):
                            await self._smart_wait(2, 3)
                            break

                # Check for CAPTCHA
                if await self._is_captcha_present(page):
                    logger.warning(f"🔐 DataDome CAPTCHA detected during '{name}' strategy.")
                    if self._headful:
                        logger.warning("⚠️ Please solve the CAPTCHA in the browser window.")
                        if await self._wait_for_captcha_solve(page, max_wait=100):
                            logger.info("✅ CAPTCHA solved! Continuing with listing...")
                            await self._smart_wait(3, 5)
                            if not await self._is_captcha_present(page):
                                logger.info("CAPTCHA confirmed clear. Proceeding...")
                            else:
                                logger.warning(f"CAPTCHA still detected after solve; skipping '{name}'")
                                continue
                    else:
                        logger.warning("Headful mode off; cannot solve CAPTCHA manually. Skipping this strategy.")
                        continue

                # Handle select_type login - but only if we haven't already logged in recently
                if "member/signup/select_type" in (page.url or ""):
                    logger.info(f"Strategy '{name}' led to select_type; checking if login needed...")
                    
                    # Check if we're actually logged in already but got redirected
                    try:
                        # Try to access a protected page to check login status
                        await page.goto(f"https://www.{self.domain}/items/new", wait_until="domcontentloaded", timeout=10000)
                        if await _wait_title_field(timeout=5000):
                            logger.info("✅ Already logged in, proceeding with listing")
                            break
                    except Exception:
                        pass
                    
                    # If not logged in, attempt login
                    logger.info("Attempting login from select_type...")
                    try:
                        login_ok = await self._handle_select_type_login(page)
                        if login_ok:
                            logger.info("Login successful, navigating to /items/new...")
                            await self._smart_wait(3, 5)
                            await self._goto_with_retry(page, f"https://www.{self.domain}/items/new", wait_until="domcontentloaded", timeout=15000)
                            await self._smart_wait(2, 4)
                            await handle_region_and_cookies(page)
                            
                            if await self._is_captcha_present(page):
                                if not await self._wait_for_captcha_solve(page, max_wait=120):
                                    logger.warning(f"CAPTCHA after login not solved; skipping '{name}'")
                                    continue
                        else:
                            logger.warning(f"Login from select_type failed; skipping '{name}'")
                            continue
                    except Exception as e:
                        logger.debug(f"select_type login error: {e}")
                        continue

                await _remove_blocking_dom(page)
                await self._smart_wait(1, 2)
                await handle_region_and_cookies(page)

                if await _wait_title_field(timeout=15000):
                    logger.info(f"✅ Found title field via strategy '{name}'")
                    break
                else:
                    logger.warning(f"Strategy '{name}' failed to find title field")
            except Exception as e:
                logger.debug(f"Strategy '{name}' failed: {e}")
                continue
        else:
            logger.error("⚠️ Listing form (title) not found in simple flow after all strategies.")
            return False

        # Fill core fields with retry
        try:
            await self._fill_with_retry(page, 'input[name="title"], input[placeholder*="itle"], textarea[name="title"], textarea[placeholder*="itle"]', title)
            logger.info(f"✅ Filled title: {title}")
        except Exception:
            logger.error("⚠️ Unable to fill title field.")
            return False

        if description:
            try:
                await self._fill_with_retry(page, 'textarea[name="description"], textarea[placeholder*="escription"]', description)
                logger.info("✅ Filled description")
            except Exception:
                logger.debug("Description field not found; continuing")

        if price is not None:
            try:
                await self._fill_with_retry(page, 'input[name="price"], input[name="price_numeric"], input[placeholder*="Price"]', str(price))
                logger.info(f"✅ Filled price: {price}")
            except Exception:
                logger.debug("Price field not found; continuing")

        # ✅ NEW: Upload image first (needed for color detection)
        await self._handle_image_upload(page, image_path)

        # ✅ NEW: Apply auto-detection and selection
        try:
            await self._apply_auto_detected_fields(page, title, description, image_path)
        except Exception as e:
            logger.warning(f"⚠️ Auto-detection failed (non-fatal): {e}")
            # Fallback to legacy dropdown filling
            try:
                await self._fill_listing_dropdowns(page)
            except Exception as e2:
                logger.warning(f"⚠️ Legacy dropdown filling also failed: {e2}")

        return True

    async def publish_listing(self, page, title, description, price, image_path=None):
        logger.info("🛍️ Opening listing form...")
        if FEATURES.get("simple_flow", False):
            ok = await self._publish_listing_simple(page, title, description, price, image_path)
            if not ok:
                return False
            
            # Check for CAPTCHA before publishing
            if await self._is_captcha_present(page):
                logger.warning("CAPTCHA detected before publish. Waiting for manual solve...")
                if not await self._wait_for_captcha_solve(page):
                    logger.error("Could not proceed past CAPTCHA.")
                    return False
            
            # Try to publish - prioritize actual publish buttons over save
            try:
                publish_selectors = [
                    'button:has-text("Upload item")',
                    'button:has-text("List item")',
                    'button:has-text("Publish")',
                    'button[type="submit"]:has-text("Upload")',
                    'button[type="submit"]:has-text("List")',
                    'button:has-text("Save")',  # Last resort
                ]
                
                for sel in publish_selectors:
                    btn = await page.query_selector(sel)
                    if btn:
                        # Check if button is actually visible and enabled
                        try:
                            visible = await btn.is_visible()
                            enabled = await btn.is_enabled()
                            if visible and enabled:
                                await btn.click()
                                logger.info(f"Clicked publish button: {sel}")
                                await page.wait_for_timeout(3000)
                                
                                # Wait for navigation or success indicator
                                try:
                                    # Wait for URL to change or success message
                                    for _ in range(10):  # Wait up to 10 seconds
                                        await asyncio.sleep(1)
                                        current_url = page.url or ""
                                        
                                        # Success indicators
                                        if any(x in current_url for x in ["/items/", "/item/", "/listing/"]):
                                            logger.info(f"✅ Listing published successfully! URL: {current_url}")
                                            return True
                                        
                                        # Check for success message in page
                                        try:
                                            html = (await page.content()).lower()
                                            if any(m in html for m in ["successfully uploaded", "item uploaded", "listing created", "successfully listed"]):
                                                logger.info("✅ Success message detected!")
                                                return True
                                        except Exception:
                                            pass
                                except Exception:
                                    pass
                                
                                # If we clicked but didn't detect success, try next button
                                break
                        except Exception:
                            continue
                
                # Check if we're on an item page even without explicit success
                current_url = page.url or ""
                if any(x in current_url for x in ["/items/", "/item/", "/listing/"]) and "new" not in current_url:
                    logger.info(f"✅ Appears to be on listing page: {current_url}")
                    return True
                    
            except Exception as e:
                logger.error(f"Publish click error: {e}")
                
            # Final check
            current_url = page.url or ""
            if any(x in current_url for x in ["/items/", "/item/"]) and "new" not in current_url:
                logger.info("✅ Listing appears to be created (based on URL)")
                return True
            else:
                logger.error(f"❌ Publish may have failed. Current URL: {current_url}")
                return False

        await page.goto(f"https://www.{self.domain}/items/new")
        await handle_region_and_cookies(page)

        # In complex flow only, detect block and recover
        if not FEATURES.get("simple_flow", False):
            if await self._is_blocked_page(page):
                ok = await self._recover_from_block(page)
                if not ok:
                    logger.error("Blocked on items/new; cannot recover")
                    return False
                await page.goto(f"https://www.{self.domain}/items/new")
                await handle_region_and_cookies(page)

        # Use robust form opener with select_type handling
        if not await self._ensure_listing_form(page):
            logger.error(f"⚠️ Listing form not available (url={page.url})")
            return False

        # Wait for title field with broadened selectors
        try:
            await page.wait_for_selector('input[name="title"], input[placeholder*="itle"], textarea[name="title"], textarea[placeholder*="itle"]', timeout=20000)
        except Exception:
            logger.warning("Timeout waiting for listing form; attempting overlay removal")
            await _remove_blocking_dom(page)
            try:
                await page.wait_for_selector('input[name="title"], input[placeholder*="itle"], textarea[name="title"], textarea[placeholder*="itle"]', timeout=8000)
            except Exception:
                logger.error("⚠️ Listing form still not available.")
                return False

        logger.info("✏️ Filling listing form...")
        await page.fill('input[name="title"], input[placeholder*="itle"], textarea[name="title"], textarea[placeholder*="itle"]', title)
        await page.fill('textarea[name="description"], textarea[placeholder*="escription"]', description)
        await page.fill('input[name="price"], input[name="price_numeric"], input[placeholder*="Price"]', str(price))

        # Category selection (best-effort)
        try:
            # Attempt to use new auto-detection and selection if available
            # NEW: call auto-detection (mix approach) before selecting categories/dropdowns
            try:
                # Auto-detection will populate self.category/self.brand/... if not explicitly set
                await self._auto_detect_fields(title, description, image_path=image_path if 'image_path' in locals() else None)
            except Exception as e:
                logger.debug(f"Auto-detect failed early in publish_listing: {e}")

            # If category is set (provided or auto-detected), select it
            if getattr(self, "category", None):
                try:
                    await self._select_category_path(page, self.category)
                except Exception as e:
                    logger.warning(f"Category auto-selection failed: {e}")
            else:
                # Fallback minimal heuristic (legacy)
                await _safe_click(page, 'button:has-text("Choose category"), button:has-text("Select category")', timeout=3000)
                for top in ['button:has-text("Women")', 'button:has-text("Men")', 'button:has-text("Kids")']:
                    if await page.query_selector(top):
                        await page.click(top)
                        await page.wait_for_timeout(300)
                        for sub in ['button:has-text("Tops")', 'button:has-text("Hoodies")', 'button:has-text("Shirts")']:
                            if await page.query_selector(sub):
                                await page.click(sub)
                                await page.wait_for_timeout(300)
                                break
                        break

        except Exception:
            logger.warning("⚠️ Category auto-selection failed (may need manual update).")

        # Upload image if available
        if image_path and os.path.exists(image_path):
            try:
                input_el = await page.query_selector('input[type="file"]')
                if not input_el:
                    label = await page.query_selector('label:has(input[type="file"])')
                    if label:
                        await label.click()
                        await page.wait_for_timeout(400)
                        input_el = await page.query_selector('input[type="file"]')
                if input_el:
                    await input_el.set_input_files(image_path)
                    logger.info("📸 Image uploaded.")
            except Exception as e:
                logger.warning(f"⚠️ Image upload failed: {e}")
        else:
            if 'image_path' in locals() and image_path:
                logger.warning("⚠️ Image file not found; skipping upload.")

        await page.wait_for_timeout(1500)

        # NEW: Select brand, color, material, size, condition if available (auto-detected or CLI provided)
        try:
            # run auto-detect again if selectors depend on image (color) and image_path exists
            try:
                await self._auto_detect_fields(title, description, image_path=image_path if 'image_path' in locals() else None)
            except Exception:
                pass

            if getattr(self, "brand", None):
                await self._select_single_dropdown(page, "Brand", self.brand)
            if getattr(self, "color", None):
                await self._select_single_dropdown(page, "Color", this.color)
            if getattr(self, "material", None):
                await self._select_single_dropdown(page, "Material", self.material)
            if getattr(self, "size", None):
                await self._select_single_dropdown(page, "Size", self.size)
            if getattr(self, "condition", None):
                await self._select_single_dropdown(page, "Condition", self.condition)
        except Exception as e:
            logger.warning(f"⚠️ Error selecting additional dropdowns: {e}")

        # Try to publish (best-effort across variants)
        try:
            for sel in ['button:has-text("Upload item")', 'button:has-text("List item")', 'button:has-text("Publish")', 'button:has-text("Save")']:
                btn = await page.query_selector(sel)
                if btn:
                    await btn.click()
                    logger.info(f"Clicked publish button: {sel}")
                    await page.wait_for_timeout(5000)
                    break
        except Exception:
            logger.error("⚠️ Publish button not found.")
            return False

        if "item" in (page.url or ""):
            logger.info("✅ Listing published successfully!")
            return True
        else:
            logger.error("❌ Listing creation failed.")
            return False

    # ✅ ADD: Missing helper methods (kept as in original file)
    async def _goto_with_retry(self, page, url, wait_until="domcontentloaded", timeout=30000, max_retries=3):
        """Navigate with retry logic for flaky networks."""
        for attempt in range(max_retries):
            try:
                await page.goto(url, wait_until=wait_until, timeout=timeout)
                # Add delay after successful navigation
                await self._smart_wait(1, 3)
                return
            except Exception as e:
                if attempt < max_retries - 1:
                    wait_time = 2 ** attempt  # Exponential backoff: 1, 2, 4 seconds
                    logger.warning(f"Navigate failed (attempt {attempt + 1}/{max_retries}): {e}. Waiting {wait_time}s")
                    await asyncio.sleep(wait_time)
                else:
                    raise

    async def _fill_with_retry(self, page, selector, value, max_retries=3):
        """Fill input field with retry logic."""
        for attempt in range(max_retries):
            try:
                el = await page.query_selector(selector)
                if el:
                    await el.fill(value)
                    return
            except Exception as e:
                if attempt < max_retries - 1:
                    logger.warning(f"Fill failed for {selector} (attempt {attempt + 1}/{max_retries}): {e}")
                    await asyncio.sleep(1)
                else:
                    raise

    async def _fill_listing_dropdowns(self, page):
        """Fill dropdown fields (size, brand, condition, etc.) if present."""
        dropdown_configs = [
            {
                "name": "Size",
                "selectors": ['select[name="size_id"]', 'button:has-text("Size")', '[data-testid="size-select"]'],
                "options": ["S", "M", "L", "XL"]
            },
            {
                "name": "Brand",
                "selectors": ['input[name="brand"]', 'input[placeholder*="Brand"]'],
                "value": "Nike"
            },
            {
                "name": "Condition",
                "selectors": ['select[name="status_id"]', 'button:has-text("Condition")'],
                "options": ["New with tags", "New without tags", "Very good", "Good", "Satisfactory"]
            }
        ]

        for config in dropdown_configs:
            try:
                for selector in config["selectors"]:
                    el = await page.query_selector(selector)
                    if el:
                        if "input" in selector:
                            # Text input
                            value = config.get("value", "Nike")
                            await el.fill(value)
                            logger.info(f"✅ Filled {config['name']}: {value}")
                        elif "select" in selector:
                            # Dropdown select
                            options = config.get("options", [])
                            if options:
                                await el.select_option(label=options[0])
                                logger.info(f"✅ Selected {config['name']}: {options[0]}")
                        else:
                            # Button that opens a modal
                            await el.click()
                            await page.wait_for_timeout(500)
                            options = config.get("options", [])
                            if options:
                                for option in options:
                                    opt_el = await page.query_selector(f'button:has-text("{option}"), [role="option"]:has-text("{option}")')
                                    if opt_el:
                                        await opt_el.click()
                                        logger.info(f"✅ Selected {config['name']}: {option}")
                                        break
                        break
            except Exception as e:
                logger.debug(f"Could not fill {config['name']}: {e}")

    async def _handle_image_upload(self, page, image_path=None):
        """Handle image upload with placeholder generation if needed."""
        if not image_path or not os.path.exists(image_path):
            logger.warning("No valid image provided. Attempting to create placeholder...")
            
            # Create a placeholder image using ImageProcessor
            if Image:
                try:
                    # Try to create placeholder with text from title if available
                    title_text = getattr(self, '_current_title', 'Vinted Item')
                    placeholder_path = "placeholder_listing.jpg"
                    placeholder_path = ImageProcessor.create_placeholder_with_text(
                        title_text[:50],  # Limit text length
                        placeholder_path
                    )
                    logger.info(f"✅ Created placeholder image with text: {placeholder_path}")
                    image_path = placeholder_path
                except Exception as e:
                    logger.warning(f"Could not create placeholder with text: {e}")
                    # Fallback to simple placeholder
                    try:
                        placeholder_path = "placeholder_listing.jpg"
                        img = Image.new('RGB', (800, 600), color=(200, 200, 200))
                        img.save(placeholder_path, 'JPEG')
                        logger.info(f"✅ Created simple placeholder image: {placeholder_path}")
                        image_path = placeholder_path
                    except Exception as e2:
                        logger.warning(f"Could not create simple placeholder: {e2}")
                        logger.warning("⚠️ Listing will be created without an image")
                        return
            else:
                logger.warning("⚠️ Pillow not installed. Listing will be created without an image")
                return
        else:
            # Optimize existing image for Vinted
            try:
                if Image and os.path.getsize(image_path) > 2 * 1024 * 1024:  # If > 2MB
                    logger.info("Image is large, optimizing...")
                    optimized_path = ImageProcessor.optimize_for_vinted(image_path)
                    image_path = optimized_path
            except Exception as e:
                logger.debug(f"Image optimization skipped: {e}")

        # Upload the image
        try:
            input_el = await page.query_selector('input[type="file"]')
            if not input_el:
                # Try clicking label to reveal file input
                label = await page.query_selector('label:has(input[type="file"]), button:has-text("Add photo"), button:has-text("Upload")')
                if label:
                    await label.click()
                    await page.wait_for_timeout(800)
                    input_el = await page.query_selector('input[type="file"]')
            
            if input_el:
                await input_el.set_input_files(image_path)
                logger.info(f"📸 Image uploaded: {image_path}")
                await page.wait_for_timeout(1000)  # Wait for upload to process
            else:
                logger.warning("⚠️ Could not find file input element")
        except Exception as e:
            logger.warning(f"⚠️ Image upload failed: {e}")

    async def _is_captcha_present(self, page) -> bool:
        """Check if DataDome CAPTCHA is visible and blocking the page."""
        try:
            # First check for visible CAPTCHA iframes/elements
            captcha_iframe_selectors = [
                'iframe[src*="captcha-delivery.com"]',
                'iframe[src*="datadome"]',
                'iframe[title*="captcha"]',
                'iframe[title*="challenge"]',
            ]
            
            for sel in captcha_iframe_selectors:
                try:
                    el = await page.query_selector(sel)
                    if el:
                        visible = await el.is_visible()
                        if visible:
                            # Double-check it's actually blocking (has dimensions)
                            box = await el.bounding_box()
                            if box and box.get("width", 0) > 100 and box.get("height", 0) > 100:
                                logger.debug(f"Visible CAPTCHA iframe found: {sel}")
                                return True
                except Exception:
                    continue
            
            # Check for visible DataDome interstitial/overlay
            dd_selectors = [
                '#datadome',
                '.datadome-container',
                '[class*="captcha-box"]',
                '[id*="captcha-box"]',
            ]
            
            for sel in dd_selectors:
                try:
                    el = await page.query_selector(sel)
                    if el:
                        visible = await el.is_visible()
                        if visible:
                            box = await el.bounding_box()
                            if box and box.get("width", 0) > 200:
                                logger.debug(f"Visible CAPTCHA element found: {sel}")
                                return True
                except Exception:
                    continue
            
            # Only as last resort, check if page is showing a blocking CAPTCHA screen
            # (not just CAPTCHA code present in HTML)
            try:
                title = await page.title()
                title_lower = title.lower()
                if any(k in title_lower for k in ["captcha", "verify", "challenge", "security check"]):
                    logger.debug(f"CAPTCHA detected in page title: {title}")
                    return True
            except Exception:
                pass
            
            # Check if the main content is hidden and only CAPTCHA is visible
            try:
                # If we can't find common page elements, might be CAPTCHA screen
                main_selectors = [
                    'header',
                    'nav',
                    '[data-testid="header"]',
                    'input[name="title"]',
                    '.main-content',
                ]
                
                has_main_content = False
                for sel in main_selectors:
                    el = await page.query_selector(sel)
                    if el:
                        try:
                            if await el.is_visible():
                                has_main_content = True
                                break
                        except Exception:
                            pass
                
                # If no main content visible, check if it's a CAPTCHA page
                if not has_main_content:
                    html = (await page.content()).lower()
                    # Only return True if CAPTCHA is prominent and page is minimal
                    if html.count("datadome") > 3 or html.count("captcha") > 5:
                        if len(html) < 50000:  # Small page = likely interstitial
                            logger.debug("Minimal page with heavy CAPTCHA presence detected")
                            return True
            except Exception:
                pass
            
            return False
        except Exception as e:
            logger.debug(f"Error in _is_captcha_present: {e}")
            return False

    async def _wait_for_captcha_solve(self, page, max_wait: int = 120) -> bool:
        """Wait for CAPTCHA to be solved (manual or auto). Returns True if cleared."""
        logger.info(f"⏳ Waiting up to {max_wait} seconds for CAPTCHA to be solved...")
        
        for i in range(max_wait):
            await asyncio.sleep(1)
            
            # Check every 5 seconds and log progress
            if i % 5 == 0 and i > 0:
                logger.info(f"Still waiting... ({i}/{max_wait}s elapsed)")
            
            # Check if CAPTCHA is gone
            if not await self._is_captcha_present(page):
                logger.info("✅ CAPTCHA appears to have been cleared!")
                # Wait a bit more for page to stabilize
                await asyncio.sleep(2)
                # Double-check it's really gone
                if not await self._is_captcha_present(page):
                    return True
                else:
                    logger.debug("False positive - CAPTCHA still detected on recheck")
        
        logger.warning(f"❌ CAPTCHA still present after {max_wait} seconds")
        return False

    async def _wait_until_captcha_clears(self, page, context) -> bool:
        """Alias for manual solve wait."""
        return await self._wait_for_captcha_solve(page, max_wait=CAPTCHA_MAX_WAIT)

    async def _try_solve_datadome(self, context, page) -> bool:
        """Attempt to solve DataDome challenge using CapSolver API."""
        CAPSOLVER_API_KEY= os.getenv("CAPSOLVER_API_KEY", "").strip()
        try:
            from vinted_datadome_solver import solve_datadome  # Your other folder
            
            url = page.url
            cookies_dict = {c["name"]: c["value"] for c in await context.cookies()}
            
            logger.info("Attempting DataDome solve via CapSolver...")
            result = await solve_datadome(url, cookies_dict, CAPSOLVER_API_KEY)
            
            if result and result.get("cookie"):
                # Inject solved cookie
                await context.add_cookies([{
                    "name": "datadome",
                    "value": result["cookie"],
                    "domain": f".{self.domain}",
                    "path": "/"
                }])
                await page.reload()
                await asyncio.sleep(2)
                return True
            return False
        except Exception as e:
            logger.error(f"DataDome solver failed: {e}")
            return False

    async def _handle_hard_block(self, context, page) -> bool:
        """
        Handle unrecoverable 'Your session has been blocked':
        - Try lightweight recovery.
        - Try DataDome solving once (if key exists).
        - If headful AND a puzzle is visible, wait for manual solve.
        - If still blocked, clear cookies, delete cookie file (if enabled), back off, and signal retry.
        """
        try:
            logger.warning("Hard block detected; attempting recovery...")
            ok = await self._recover_from_block(page)
            if ok and not await self._is_blocked_page(page):
                logger.info("Recovered from block page.")
                self._blocked_recently = False
                return True
            CAPSOLVER_API_KEY = os.getenv("CAPSOLVER_API_KEY", "").strip()
            # Try DataDome solving before nuking cookies/rotating
            solved = False
            if CAPSOLVER_API_KEY:  # Only try if key is present
                try:
                    solved = await self._try_solve_datadome(context, page)
                    if solved:
                        # Re-check quickly
                        if not await self._is_blocked_page(page):
                            logger.info("DataDome solved; block cleared.")
                            self._blocked_recently = False
                            return True
                except Exception:
                    pass

            # If solver didn't run or failed, AND we are in headful mode, check for manual solve
            if not solved and self._headful:
                
                # --- NEW CHECK ---
                # Only wait for manual solve if there is actually a puzzle on the page
                if await self._is_captcha_present(page):
                    logger.warning("🤖 Solver key not found or failed. Please solve the CAPTCHA manually in the browser window.")
                    logger.info(f"Waiting up to {CAPTCHA_MAX_WAIT} seconds for you to solve it...")
                    try:
                        # We still use the _wait_until_captcha_clears function
                        manual_solve_ok = await self._wait_until_captcha_clears(page, context)
                        if manual_solve_ok:
                            logger.info("✅ CAPTCHA appears to be solved manually. Resuming...")
                            self._blocked_recently = False
                            return True
                        else:
                            logger.warning("Manual CAPTCHA solve timed out or was not detected.")
                    except Exception as e:
                        logger.warning(f"Error during manual CAPTCHA wait: {e}")
                else:
                    logger.warning("Page is blocked, but no solvable CAPTCHA was found. Cannot wait for manual solve.")
                # --- END NEW CHECK ---


            # Still blocked: nuke cookies and back off
            logger.warning("Block still present. Proceeding to nuke cookies and rotate session.")
            try:
                await page.context.clear_cookies()
            except Exception:
                pass
            if FEATURES.get("nuke_cookies_on_block", True) and os.path.exists(self.cookies_path):
                try:
                    os.remove(self.cookies_path)
                    logger.info(f"🧹 Deleted cookies file due to hard block: {self.cookies_path}")
                except Exception:
                    pass

            self._blocked_recently = True
            logger.warning("Block unrecoverable; will retry with new proxy/UA...")
            return False
        except Exception:
            self._blocked_recently = True
            return False
   

    async def _new_browser_context(self, p, engine: str, proxy: str | None, ua: str):
        """
        Create a browser/context/page triple with given engine/proxy/UA.
        If engine == "chromium" we launch a persistent context using the real Chrome
        binary (channel="chrome") and a user_data_dir (VINTED_PROFILE_DIR or default).
        This helps bypass Datadome fingerprinting by using a real human profile.
        """
        # Prepare common args
        base_args = [
            "--disable-blink-features=AutomationControlled",
        ]

        # Prepare extra headers
        extra_headers = {
            "Accept-Language": "en-GB,en;q=0.9",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Upgrade-Insecure-Requests": "1",
            "Pragma": "no-cache",
            "Cache-Control": "no-cache",
            "Referer": f"https://www.{self.domain}/",
        }
        if engine == "chromium":
            extra_headers.update({
                "sec-ch-ua": '"Chromium";v="120", "Not=A?Brand";v="99"',
                "sec-ch-ua-platform": '"Windows"',
                "sec-ch-ua-mobile": "?0",
            })

        # If running chromium, prefer the real Chrome binary + persistent profile
        if engine == "chromium":
            # profile dir (can be set via env VINTED_PROFILE_DIR)
            profile_dir = os.getenv("VINTED_PROFILE_DIR", r"C:\Users\Dell\.vinted_profile")
            # Expand ~ and normalize
            profile_dir = os.path.expanduser(profile_dir)

            # See whether profile existed before launching (for manual-login prompt)
            profile_existed = os.path.exists(profile_dir) and os.listdir(profile_dir)

            launch_kwargs = {
                "user_data_dir": profile_dir,
                "headless": False,            # always headful for anti-bot flows
                "channel": "chrome",          # use the real Chrome binary
                "args": base_args,
                # Pass the same options we would pass to new_context
                "user_agent": ua,
                "viewport": {"width": 1366, "height": 768},
                "locale": "en-GB",
                "timezone_id": "Europe/London",
                "extra_http_headers": extra_headers,
            }
            if proxy:
                launch_kwargs["proxy"] = {"server": proxy}
                logger.info(f"Using proxy: {proxy}")

            # Launch persistent context (returns a BrowserContext)
            context = await p.chromium.launch_persistent_context(**launch_kwargs)
            # For compatibility with code that expects a Browser object, obtain the attached browser
            browser = context.browser

            page = await context.new_page()

            # If this is a freshly created profile, prompt the user to log in once manually
            if not profile_existed:
                logger.warning(f"⚠️ Profile '{profile_dir}' does not exiist. Creating new one...")

        return browser, context, page
        
    # ----------------------------
    # END OF NEW HELPERS
    # ----------------------------

    # ----------------------------
    # ✅ NEW: Auto-detection and Selection Helpers
    # Added below without removing any existing logic
    # ----------------------------

    # ──────────────────────────────────────────────────────────────────────────────────
    # 🟢 PHASE 1: IMPROVED SELECTOR HELPERS
    # ──────────────────────────────────────────────────────────────────────────────────

    async def _select_dropdown_by_testid(self, page, testid: str, value: str) -> bool:
        """
        NEW: Handle Vinted's dropdown UI using data-testid pattern.
        Works for: brand, color, size, condition, material fields.
        
        Example HTML:
        <div data-testid="brand-select-dropdown-input">
            <input type="text" ...>
        </div>
        """
        if not value:
            return False
        
        logger.info(f"🎯 Selecting dropdown [{testid}]: {value}")
        
        try:
            # Find container by data-testid
            container_selector = f'[data-testid="{testid}"]'
            container = await page.query_selector(container_selector)
            
            if not container:
                logger.debug(f"Container not found: {testid}")
                return False
            
            # Find input inside container
            input_el = await container.query_selector('input[type="text"], input:not([type])')
            
            if not input_el:
                logger.debug(f"Input not found in container: {testid}")
                return False
            
            # Click to focus and open dropdown
            await input_el.click()
            await page.wait_for_timeout(800)
            
            # Clear existing value
            await input_el.fill('')
            await page.wait_for_timeout(300)
            
            # Type the value
            await input_el.fill(value)
            await page.wait_for_timeout(1200)
            
            # Try to select from dropdown options
            option_selectors = [
                f'li:has-text("{value}")',
                f'div[role="option"]:has-text("{value}")',
                f'button:has-text("{value}")',
                f'[data-testid*="option"]:has-text("{value}")',
            ]
            
            for opt_sel in option_selectors:
                try:
                    options = await page.query_selector_all(opt_sel)
                    for opt in options:
                        try:
                            text = (await opt.inner_text()).strip()
                            # Exact or close match
                            if text == value or (value.lower() in text.lower() and len(text) < len(value) + 10):
                                await opt.click()
                                await page.wait_for_timeout(600)
                                logger.info(f"  ✓ Selected from dropdown: {text}")
                                
                                # Dismiss any popup that appears
                                await self._dismiss_popup_if_present(page)
                                return True
                        except Exception:
                            continue
                except Exception:
                    continue
            
            # If no dropdown option found, press Enter to confirm typed value
            logger.info(f"  ⚠️ No dropdown option found, confirming typed value")
            await page.keyboard.press('Enter')
            await page.wait_for_timeout(600)
            
            # Dismiss any popup
            await self._dismiss_popup_if_present(page)
            
            return True
            
        except Exception as e:
            logger.debug(f"_select_dropdown_by_testid failed for {testid}: {e}")
            return False

    async def _dismiss_popup_if_present(self, page) -> None:
        """Dismiss any modal/popup that appears after selection."""
        try:

            # Common popup close button selectors
            close_selectors = [
                'button[aria-label="Close"]',
                'button:has-text("Close")',
                '[data-testid*="close"]',
                '.modal button.close',
                'button.modal-close',
            ]
            
            for sel in close_selectors:
                try:
                    btn = await page.query_selector(sel)
                    if btn:
                        visible = await btn.is_visible()
                        if visible:
                            await btn.click()
                            await page.wait_for_timeout(400)
                            logger.debug("Dismissed popup")
                            return
                except Exception:
                    continue
        except Exception:
            pass

    async def _select_category_path(self, page, category_path: str) -> bool:
        """
        IMPROVED: Multi-level category selection with exact text matching.
        Handles radio button final categories properly.
        
        Example: "Women / Shoes / Trainers" or "Men / Shoes / Sneakers"
        """
        if not category_path:
            return False
        
        logger.info(f"📂 Selecting category path: {category_path}")
        
        # Step 1: Try suggested category first
        try:
            suggested_btn = await page.query_selector('[data-testid="catalog-suggestion"]')
            if suggested_btn:
                suggested_text = await suggested_btn.inner_text()
                final_category = category_path.split('/')[-1].strip()
                if final_category.lower() in suggested_text.lower():
                    await suggested_btn.click()
                    await page.wait_for_timeout(1000)
                    logger.info(f"✅ Used suggested category: {suggested_text}")
                    return True
        except Exception as e:
            logger.debug(f"No suggested category: {e}")
        
        # Step 2: Open category dropdown
        dropdown_selectors = [
            '[data-testid="catalog-select-dropdown-input"]',
            'input[id="category"]',
            '[data-testid="catalog-select"]',
        ]
        
        opened = False
        for sel in dropdown_selectors:
            try:
                btn = await page.query_selector(sel)
                if btn:
                    await btn.click()
                    await page.wait_for_timeout(1200)
                    logger.info(f"📂 Opened category dropdown via: {sel}")
                    opened = True
                    break
            except Exception:
                continue
        
        if not opened:
            logger.warning("⚠️ Could not open category dropdown")
            return False
        
        # Step 3: Navigate through hierarchy levels
        levels = [x.strip() for x in category_path.split("/")]
        
        for i, level in enumerate(levels):
            logger.info(f"  ↳ Level {i+1}/{len(levels)}: {level}")
            
            # Wait for options to load
            await page.wait_for_timeout(1000)
            
            is_final_level = (i == len(levels) - 1)
            
            # Build selectors with exact text matching
            selectors = [
                # Try XPath for exact match first
                f'xpath=//button[normalize-space(text())="{level}"]',
                f'xpath=//div[normalize-space(text())="{level}"]',
                # Then CSS selectors
                f'div.web_ui__Cell__title:has-text("{level}")',
                f'button:has-text("{level}")',
                f'div.web_ui__Cell__cell:has-text("{level}")',
            ]
            
            clicked = False
            
            # Try each selector
            for sel_idx, sel in enumerate(selectors):
                try:
                    if 'xpath=' in sel:
                        # Handle XPath selector
                        xpath_expr = sel.replace('xpath=', '')
                        elements = await page.locator(f'xpath={xpath_expr}').all()
                        
                        for el in elements:
                            try:
                                text = (await el.inner_text()).strip()
                                
                                # Exact match only
                                if text == level:
                                    # For final level with radio button, click parent cell
                                    if is_final_level:
                                        try:
                                            parent_cell = await el.evaluate_handle('''el => {
                                                let current = el;
                                                while (current && !current.className.includes('web_ui__Cell__cell')) {
                                                    current = current.parentElement;
                                                }
                                                return current || el;
                                            }''')
                                            await parent_cell.as_element().click()
                                        except Exception:
                                            await el.click()
                                    else:
                                        await el.click()
                                    
                                    await page.wait_for_timeout(1200)
                                    logger.info(f"    ✓ Selected: {level} (exact match)")
                                    clicked = True
                                    break
                            except Exception:
                                continue
                    else:
                        # Handle CSS selector
                        elements = await page.query_selector_all(sel)
                        
                        for el in elements:
                            try:
                                text = (await el.inner_text()).strip()
                                
                                # Exact match to prevent "Women" matching "Men"
                                if text == level:
                                    if is_final_level:
                                        # Try to find parent cell for radio button
                                        try:
                                            parent_cell = await el.evaluate_handle('''el => {
                                                let current = el;
                                                while (current && !current.className.includes('web_ui__Cell__cell')) {
                                                    current = current.parentElement;
                                                }
                                                return current || el;
                                            }''')
                                            await parent_cell.as_element().click()
                                        except Exception:
                                            await el.click()
                                    await page.wait_for_timeout(1200)
                                    logger.info(f"    ✓ Selected: {level}")
                                    clicked = True
                                    break
                            except Exception:
                                continue
                    
                    if clicked:
                        break
                        
                except Exception as e:
                    logger.debug(f"Selector {sel_idx} failed: {e}")
                    continue
            
            if not clicked:
                logger.warning(f"    ✗ Could not select level: {level}")
                return False
        
        # Wait for category-dependent fields to load
        logger.info("⏳ Waiting for category-dependent fields to load...")
        await page.wait_for_timeout(2500)
        
        logger.info("✅ Category hierarchy selected successfully")
        return True

    async def _apply_all_field_selections_new(self, page, title: str, description: str, image_path: str | None = None):
        """
        NEW ORCHESTRATION: Apply all field selections in correct order.
        Called after basic fields (title/desc/price) and image are filled.
        """
        logger.info("🔄 Starting improved field selection process...")
        
        # Step 1: Auto-detect all fields
        try:
            await self._auto_detect_all_fields(title, description, image_path)
        except Exception as e:
            logger.warning(f"Auto-detection error (non-fatal): {e}")
        
        # Step 2: Select category FIRST (required before other fields load)
        if self.category:
            try:
                success = await self._select_category_path(page, self.category)
                if not success:
                    logger.warning("Category selection failed, trying fallback...")
                    await self._select_category_hierarchical(page, self.category)
                    await page.wait_for_timeout(2000)
            except Exception as e:
                logger.warning(f"Category selection failed: {e}")
        
        # Step 3: Select Brand
        if self.brand:
            try:
                success = await self._select_dropdown_by_testid(page, "brand-select-dropdown-input", self.brand)
                if not success:
                    # Fallback to original logic
                    await self._select_dropdown_value(page, "Brand", self.brand)
                await page.wait_for_timeout(500)
            except Exception as e:
                logger.warning(f"Brand selection failed: {e}")
        
        # Step 4: Select Colour
        if self.color:
            try:
                success = await self._select_dropdown_by_testid(page, "color-select-dropdown-input", this.color)
                if not success:
                    await self._select_dropdown_value(page, "Color", this.color)
                await page.wait_for_timeout(500)
            except Exception as e:
                logger.warning(f"Color selection failed: {e}")
        
        # Step 5: Select Size
        if self.size:
            try:
                success = await self._select_dropdown_by_testid(page, "size-select-dropdown-input", self.size)
                if not success:
                    await self._select_dropdown_value(page, "Size", self.size)
                await page.wait_for_timeout(500)
            except Exception as e:
                logger.warning(f"Size selection failed: {e}")
        
        # Step 6: Select Material (if applicable)
        if self.material:
            try:
                success = await self._select_dropdown_by_testid(page, "category-material-multi-list-input", self.material)
                if not success:
                    await self._select_dropdown_value(page, "Material", self.material)
                await page.wait_for_timeout(500)
            except Exception as e:
                logger.warning(f"Material selection failed: {e}")
        
        # Step 7: Select Condition
        if self.condition:
            try:
                success = await self._select_dropdown_by_testid(page, "condition-select-dropdown-input", self.condition)
                if not success:
                    await self._select_dropdown_value(page, "Condition", self.condition)
                await page.wait_for_timeout(500)
            except Exception as e:
                logger.warning(f"Condition selection failed: {e}")
        
        logger.info("✅ All field selections completed")
        await page.wait_for_timeout(1000)

    # Update _apply_auto_detected_fields to use new process
    async def _apply_auto_detected_fields(self, page, title: str, description: str, image_path: str | None = None):
        """Apply all auto-detected fields to the listing form."""
        # Try new improved process first
        try:
            await self._apply_all_field_selections_new(page, title, description, image_path)
            return
        except Exception as e:
            logger.warning(f"New field selection process failed: {e}")
            logger.info("Falling back to original field selection logic...")
        
        # Original logic as fallback (kept intact)
        try:
            if self.category:
                try:
                    await self._select_category_hierarchical(page, self.category)
                    await page.wait_for_timeout(2000)
                except Exception as e:
                    logger.warning(f"Category selection failed: {e}")
            
            if self.brand:
                try:
                    await self._select_dropdown_value(page, "Brand", self.brand)
                    await page.wait_for_timeout(500)
                except Exception as e:
                    logger.warning(f"Brand selection failed: {e}")
            
            if self.color:
                try:
                    await self._select_dropdown_value(page, "Color", this.color)
                    await page.wait_for_timeout(500)
                except Exception as e:
                    logger.warning(f"Color selection failed: {e}")
            
            if self.material:
                try:
                    await self._select_dropdown_value(page, "Material", self.material)
                    await page.wait_for_timeout(500)
                except Exception as e:
                    logger.warning(f"Material selection failed: {e}")
            
            if self.size:
                try:
                    await self._select_dropdown_value(page, "Size", self.size)
                    await page.wait_for_timeout(500)
                except Exception as e:
                    logger.warning(f"Size selection failed: {e}")
            
            if self.condition:
                try:
                    await self._select_dropdown_value(page, "Condition", self.condition)
                    await page.wait_for_timeout(500)
                except Exception as e:
                    logger.warning(f"Condition selection failed: {e}")
            
            logger.info("✅ All auto-detected fields applied")
            await page.wait_for_timeout(1000)
            
        except Exception as e:
            logger.warning(f"Auto-detection/application failed: {e}")

    async def run(self, title, description, price, image=None, headful=False, mode="publish", item_id=None):
        """
        Orchestrate browser setup, login, and operation based on mode.
        
        Modes:
        - "publish": Create new listing (default)
        - "repost": Repost old listings (or specific item if item_id provided)
        - "repost_specific": Repost a specific listing by item_id
        - "sync_stock": Sync stock with listings
        - "check_sales": Check for new sales
        """
        self._headful = headful
        
        async with async_playwright() as p:
            # ...existing profile setup code...
            profile = os.getenv("VINTED_PROFILE_DIR", "").strip()
            if not profile:
                profile = os.path.expanduser("~/.vinted_profile")
            
            if not os.path.exists(profile):
                logger.warning(f"⚠️ Profile '{profile}' does not exist. Creating new one...")
                logger.warning("Please log into Vinted manually in the opened browser window, then close it.")
                os.makedirs(profile, exist_ok=True)
            
            await self._smart_wait(1, 5)
            
            try:
                context = await p.chromium.launch_persistent_context(
                    user_data_dir=profile,
                    headless=not headful,
                    args=[
                        "--disable-blink-features=AutomationControlled",
                        "--disable-dev-shm-usage",
                        "--disable-gpu",
                        "--lang=en-GB",
                    ],
                    channel="chrome",
                )
                pages = context.pages
                page = pages[0] if pages else await context.new_page()
                
                logger.info(f"✅ Persistent context launched (profile: {profile})")
                
                try:
                    await apply_stealth(page)
                except Exception:
                    pass
                
                await self._smart_wait(2, 4)
                
                try:
                    logged_in = await self.ensure_logged_in(context, page, use_cookies=False)
                    if not logged_in:
                        logger.error("❌ Failed to log in")
                        await context.close()
                        return False
                    
                    logger.info("⏳ Waiting for session to stabilize after login...")
                    await self._smart_wait(5, 8)
                    
                    # Execute based on mode
                    result = False
                    if mode == "publish":
                        result = await self.publish_listing(page, title, description, price, image)
                    elif mode == "repost":
                        if item_id:
                            # Repost specific listing
                            result = await self.repost_listing_by_id(page, item_id)
                        else:
                            # Auto-repost old listings
                            repost_results = await self.auto_repost_old_listings(page, max_age_hours=24, max_reposts=5)
                            result = repost_results["success"] > 0
                    elif mode == "repost_specific":
                        if not item_id:
                            logger.error("item_id required for repost_specific mode")
                            result = False
                        else:
                            result = await self.repost_listing_by_id(page, item_id)
                    elif mode == "sync_stock":
                        sync_results = await self.sync_stock_with_listings(page)
                        result = sync_results["errors"] == 0
                    elif mode == "check_sales":
                        sold_items = await self.check_sold_items(page)
                        result = True  # Always succeed for check
                    else:
                        logger.error(f"Unknown mode: {mode}")
                        result = False
                    
                    await context.close()
                    return result
                except Exception as e:
                    logger.error(f"Error during run: {e}", exc_info=True)
                    try:
                        await context.close()
                    except Exception:
                        pass
                    return False
            except Exception as e:
                logger.error(f"Failed to launch persistent context: {e}")
                return False

    async def repost_listing(self, page, listing_url: str) -> bool:
        """
        Repost/bump an existing listing to refresh it.
        Vinted doesn't have a native 'bump' feature, so this works by:
        1. Navigating to the listing
        2. Clicking edit
        3. Making a minor change (or not)
        4. Saving to refresh timestamp
        """
        logger.info(f"🔄 Reposting listing: {listing_url}")
        
        try:
            # Navigate to listing
            await self._goto_with_retry(page, listing_url)
            await self._smart_wait(2, 4)
            await handle_region_and_cookies(page)
            
            # Check if we're the owner
            try:
                edit_btn = await page.query_selector('button:has-text("Edit"), a:has-text("Edit"), [data-testid="edit-item"]')
                if not edit_btn:
                    logger.warning("Edit button not found - may not be owner of this listing")
                    return False
            except Exception:
                logger.warning("Could not verify ownership of listing")
                return False
            
            # Click edit
            await edit_btn.click()
            await self._smart_wait(2, 3)
            
            # Wait for edit form to load
            try:
                await page.wait_for_selector('input[name="title"], textarea[name="title"]', timeout=10000)
            except Exception:
                logger.error("Edit form did not load")
                return False
            
            # Make a minor change to trigger update (add/remove space in description)
            try:
                desc_field = await page.query_selector('textarea[name="description"]')
                if desc_field:
                    current_desc = await desc_field.input_value()
                    # Add a space at the end, then remove it (no actual change to content)
                    await desc_field.fill(current_desc + " ")
                    await page.wait_for_timeout(500)
                    await desc_field.fill(current_desc)
                    logger.info("Made minor edit to trigger refresh")
            except Exception as e:
                logger.debug(f"Could not make minor edit: {e}")
            
            # Save/Update the listing
            save_selectors = [
                'button:has-text("Save")',
                'button:has-text("Update")',
                'button[type="submit"]:has-text("Save")',
                'button[type="submit"]:has-text("Update")',
            ]
            
            saved = False
            for sel in save_selectors:
                try:
                    btn = await page.query_selector(sel)
                    if btn:
                        visible = await btn.is_visible()
                        enabled = await btn.is_enabled()
                        if visible and enabled:
                            await btn.click()
                            logger.info(f"Clicked save button: {sel}")
                            await self._smart_wait(3, 5)
                            saved = True
                            break
                except Exception:
                    continue
            
            if not saved:
                logger.error("Could not find/click save button")
                return False
            
            # Check if we're back on the listing page
            await page.wait_for_timeout(2000)
            current_url = page.url or ""
            if "/items/" in current_url or "/item/" in current_url:
                logger.info("✅ Listing reposted successfully!")
                
                # Extract item ID and update repost time in stock manager
                try:
                    match = re.search(r'/items/(\d+)', current_url)
                    if match:
                        item_id = match.group(1)
                        self.stock_manager.update_repost_time(item_id)
                        logger.info(f"Updated repost timestamp for item {item_id}")
                except Exception:
                    pass
                
                return True
            else:
                logger.warning(f"Unexpected URL after repost: {current_url}")
                return False
                
        except Exception as e:
            logger.error(f"Repost failed: {e}", exc_info=True)
            return False

    async def repost_listing_by_id(self, page, item_id: str) -> bool:
        """
        Repost a listing by its item ID.
        Constructs the URL and calls repost_listing.
        """
        listing_url = f"https://www.{self.domain}/items/{item_id}"
        logger.info(f"🔄 Reposting item ID: {item_id}")
        return await self.repost_listing(page, listing_url)

    async def get_my_listings(self, page) -> list:
        """
        Fetch list of user's active listings from their profile.
        Returns list of dicts with listing URLs and basic info.
        """
        logger.info("📋 Fetching your listings...")
        
        try:
            # Go to user's items page
            profile_url = f"https://www.{self.domain}/member/{self.account_id}"
            await self._goto_with_retry(page, profile_url)
            await self._smart_wait(2, 3)
            await handle_region_and_cookies(page)
            
            # Find "Items" tab and click it
            try:
                items_tab = await page.query_selector('a:has-text("Items"), button:has-text("Items"), [data-testid="profile-items-tab"]')
                if items_tab:
                    await items_tab.click()
                    await page.wait_for_timeout(2000)
            except Exception:
                pass
            
            # Scroll to load more items
            for _ in range(3):
                await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                await page.wait_for_timeout(1000)
            
            # Extract listing links
            listings = []
            try:
                # Common selectors for listing cards
                item_links = await page.query_selector_all('a[href*="/items/"]')
                
                seen_urls = set()
                for link in item_links:
                    try:
                        href = await link.get_attribute("href")
                        if href and "/items/" in href and href not in seen_urls:
                            full_url = href if href.startswith("http") else f"https://www.{self.domain}{href}"
                            seen_urls.add(href)
                            
                            # Extract item ID from URL
                            match = re.search(r'/items/(\d+)', href)
                            item_id = match.group(1) if match else None
                            
                            # Try to extract title and price
                            title = "Unknown"
                            price = None
                            try:
                                title_el = await link.query_selector('[data-testid="item-title"], .item-title, h3, h4')
                                if title_el:
                                    title = (await title_el.inner_text()).strip()
                            except Exception:
                                pass
                            
                            try:
                                price_el = await link.query_selector('[data-testid="item-price"], .item-price, .price')
                                if price_el:
                                    price_text = (await price_el.inner_text()).strip()
                                    # Extract number from price text
                                    match = re.search(r'[\d,\.]+', price_text)
                                    if match:
                                        price = float(match.group().replace(',', ''))
                            except Exception:
                                pass
                            
                            listings.append({
                                "url": full_url,
                                "item_id": item_id,
                                "title": title,
                                "price": price
                            })
                    except Exception:
                        continue
                
                logger.info(f"✅ Found {len(listings)} listings")
                return listings
                
            except Exception as e:
                logger.error(f"Failed to extract listings: {e}")
                return []
                
        except Exception as e:
            logger.error(f"Failed to fetch listings: {e}")
            return []

    async def auto_repost_old_listings(self, page, max_age_hours: int = 24, max_reposts: int = 5) -> dict:
        """
        Automatically repost listings older than X hours.
        Returns dict with success/fail counts.
        """
        logger.info(f"🤖 Auto-reposting listings older than {max_age_hours} hours...")
        
        # Get listings that need reposting
        to_repost = self.stock_manager.get_listings_to_repost(hours=max_age_hours)
        
        if not to_repost:
            logger.info("No listings need reposting at this time")
            return {"success": 0, "failed": 0, "skipped": 0}
        
        logger.info(f"Found {len(to_repost)} listings to repost")
        
        results = {"success": 0, "failed": 0, "skipped": 0}
        
        for listing_id, data in to_repost[:max_reposts]:
            try:
                # Skip if already reposted too many times
                if data.get("repost_count", 0) >= 10:
                    logger.info(f"Skipping {listing_id} - already reposted 10 times")
                    results["skipped"] += 1
                    continue
                
                listing_url = data.get("url")
                if not listing_url:
                    logger.warning(f"No URL for listing {listing_id}")
                    results["skipped"] += 1
                    continue
                
                logger.info(f"Reposting: {data.get('title', listing_id)}")
                
                success = await self.repost_listing(page, listing_url)
                
                if success:
                    results["success"] += 1
                    logger.info(f"✅ Reposted successfully")
                else:
                    results["failed"] += 1
                    logger.warning(f"❌ Repost failed")
                
                # Rate limiting between reposts
                await self._smart_wait(5, 10)
                
            except Exception as e:
                logger.error(f"Error reposting {listing_id}: {e}")
                results["failed"] += 1
        
        logger.info(f"📊 Repost summary: {results['success']} succeeded, {results['failed']} failed, {results['skipped']} skipped")
        return results

    async def check_sold_items(self, page) -> list:
        """
        Check for sold items and update stock accordingly.
        Returns list of sold item IDs.
        """
        logger.info("🔍 Checking for sold items...")
        
        try:
            # Go to sales/orders page
            sales_url = f"https://www.{self.domain}/transactions/sales"
            await self._goto_with_retry(page, sales_url)
            await self._smart_wait(2, 3)
            await handle_region_and_cookies(page)
            
            sold_items = []
            
            # Look for recent sales
            try:
                # Find sale cards/rows
                sale_elements = await page.query_selector_all('[data-testid="transaction-item"], .transaction-item, .sale-item')
                
                for elem in sale_elements[:10]:  # Check last 10 sales
                    try:
                        # Extract item ID from link
                        link = await elem.query_selector('a[href*="/items/"]')
                        if link:
                            href = await link.get_attribute("href")
                            # Extract item ID from URL
                            match = re.search(r'/items/(\d+)', href)
                            if match:
                                item_id = match.group(1)
                                
                                # Check if this is a new sale (not already processed)
                                inventory = self.stock_manager.load_inventory()
                                if item_id in inventory["listings"]:
                                    if inventory["listings"][item_id].get("status") != "sold":
                                        sold_items.append(item_id)
                                        self.stock_manager.mark_as_sold(item_id)
                                        logger.info(f"✅ Marked item {item_id} as sold")
                    except Exception:
                        continue
                        
            except Exception as e:
                logger.error(f"Failed to parse sold items: {e}")
            
            if sold_items:
                logger.info(f"📦 Found {len(sold_items)} newly sold items")
            else:
                logger.info("No new sold items")
            
            return sold_items
            
        except Exception as e:
            logger.error(f"Failed to check sold items: {e}")
            return []

    async def sync_stock_with_listings(self, page) -> dict:
        """
        Sync current stock levels with active listings.
        Auto-delist items that are out of stock.
        Returns sync summary.
        """
        logger.info("🔄 Syncing stock with listings...")
        
        try:
            inventory = self.stock_manager.load_inventory()
            
            # Get current listings
            listings = await self.get_my_listings(page)
            
            results = {
                "checked": len(listings),
                "delisted": 0,
                "errors": 0
            }
            
            for listing in listings:
                try:
                    # Extract item ID from URL
                    match = re.search(r'/items/(\d+)', listing["url"])
                    if not match:
                        continue
                    
                    item_id = match.group(1)
                    stock = self.stock_manager.get_stock(item_id)
                    
                    # If out of stock, delist
                    if stock <= 0:
                        logger.info(f"Item {item_id} is out of stock, delisting...")
                        success = await self.delist_item(page, listing["url"])
                        if success:
                            results["delisted"] += 1
                            logger.info(f"✅ Delisted {listing['title']}")
                        else:
                            results["errors"] += 1
                            logger.warning(f"❌ Failed to delist {listing['title']}")
                        
                        # Rate limiting
                        await self._smart_wait(3, 5)
                        
                except Exception as e:
                    logger.error(f"Error processing listing: {e}")
                    results["errors"] += 1
            
            logger.info(f"📊 Stock sync complete: {results['delisted']} delisted, {results['errors']} errors")
            return results
            
        except Exception as e:
            logger.error(f"Stock sync failed: {e}")
            return {"checked": 0, "delisted": 0, "errors": 1}

    async def delist_item(self, page, listing_url: str) -> bool:
        """
        Delist/remove an item (mark as sold or delete).
        """
        logger.info(f"🗑️ Delisting item: {listing_url}")
        
        try:
            await self._goto_with_retry(page, listing_url)
            await self._smart_wait(2, 3)
            
            # Look for delete/remove button (usually in options menu)
            try:
                # Click options/menu button
                menu_btn = await page.query_selector('button[aria-label="More options"], [data-testid="item-menu"], button:has-text("⋮")')
                if menu_btn:
                    await menu_btn.click()
                    await page.wait_for_timeout(1000)
            except Exception:
                pass
            
            # Try to find delete/remove option
            delete_selectors = [
                'button:has-text("Delete")',
                'button:has-text("Remove")',
                'a:has-text("Delete")',
                'a:has-text("Remove")',
                '[data-testid="delete-item"]',
            ]
            
            for sel in delete_selectors:
                try:
                    btn = await page.query_selector(sel)
                    if btn:
                        await btn.click()
                        await page.wait_for_timeout(1000)
                        
                        # Confirm deletion if prompted
                        confirm_btn = await page.query_selector('button:has-text("Confirm"), button:has-text("Yes"), button:has-text("Delete")')
                        if confirm_btn:
                            await confirm_btn.click()
                            await page.wait_for_timeout(2000)
                        
                        logger.info("✅ Item delisted successfully")
                        return True
                except Exception:
                    continue
            
            logger.warning("Could not find delete button")
            return False
            
        except Exception as e:
            logger.error(f"Failed to delist item: {e}")
            return False
# --- Runner Section ---
if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="Automate Vinted Listing Upload & Management")
    parser.add_argument("--account", type=str, required=True, help="Vinted account ID")
    parser.add_argument("--username", type=str, required=True, help="Vinted login email/username")
    parser.add_argument("--password", type=str, required=True, help="Vinted password")
    
    # ✅ UPDATED: Mode selection with repost_specific
    parser.add_argument("--mode", type=str, default="publish", 
                        choices=["publish", "repost", "repost_specific", "sync_stock", "check_sales"],
                        help="Operation mode: publish, repost (auto or specific), repost_specific, sync_stock, check_sales")
    
    # Publishing args
    parser.add_argument("--title", type=str, default=None, help="Item title")
    parser.add_argument("--description", type=str, default="No description", help="Item description")
    parser.add_argument("--price", type=float, default=5.0, help="Item price")
    parser.add_argument("--image", type=str, default=None, help="Optional image path")
    parser.add_argument("--headful", action="store_true", help="Show browser window")

    # ✅ UPDATED: Stock management args with item-id for reposting
    parser.add_argument("--item-id", type=str, default=None, help="Item ID for repost/stock operations")
    parser.add_argument("--quantity", type=int, default=1, help="Stock quantity")
    
    # ✅ NEW: Listing URL for direct repost
    parser.add_argument("--listing-url", type=str, default=None, help="Direct listing URL to repost")
    
    # Field overrides
    parser.add_argument("--category", type=str, default=None, help="Optional category path")
    parser.add_argument("--brand", type=str, default=None, help="Optional brand override")
    parser.add_argument("--color", type=str, default=None, help="Optional color override")
    parser.add_argument("--material", type=str, default=None, help="Optional material override")
    parser.add_argument("--size", type=str, default=None, help="Optional size override")
    parser.add_argument("--condition", type=str, default=None, help="Optional condition override")

    args = parser.parse_args()

    # Validate mode-specific requirements
    if args.mode == "publish" and not args.title:
        logger.error("--title is required for publish mode")
        sys.exit(1)
    
    if args.mode == "repost_specific" and not args.item_id and not args.listing_url:
        logger.error("--item-id or --listing-url is required for repost_specific mode")
        sys.exit(1)

    # Validate and normalize image path
    image_path = args.image
    if image_path:
        if image_path.lower() in ["none", "none.png", "null", "na", "n/a"]:
            logger.info("Image path set to 'none' - will use placeholder if available")
            image_path = None
        elif not os.path.exists(image_path):
            logger.warning(f"Image file not found: {image_path} - will use placeholder if available")
            image_path = None

    bot = VintedBot(
        account_id=args.account,
        username=args.username,
        password=args.password
    )

    # Apply manual overrides if provided
    if args.category:
        bot.category = args.category
    if args.brand:
        bot.brand = args.brand
    if args.color:
        bot.color = args.color
    if args.material:
        bot.material = args.material
    if args.size:
        bot.size = args.size
    if args.condition:
        bot.condition = args.condition

    try:
        result = asyncio.run(bot.run(
            title=args.title or "Placeholder",
            description=args.description,
            price=args.price,
            image=image_path,
            headful=args.headful,
            mode=args.mode,
            item_id=args.item_id
        ))
        print(json.dumps({"success": bool(result)}), flush=True)
        sys.exit(0 if result else 1)
    except Exception as e:
        logger.error(f"Error occurred: {e}", exc_info=True)
        print(json.dumps({"success": False, "error": str(e)}), flush=True)
        sys.exit(1)