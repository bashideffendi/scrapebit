import os
import json
import base64
import time
import scrapy
import requests as req
import dotenv

# State directory — Docker/Railway: /data via SCRAPEBIT_STATE_DIR.
# Lokal: scraper folder root (parent of stockbit/ package).
_STATE_DIR = os.environ.get("SCRAPEBIT_STATE_DIR") or os.path.join(
    os.path.dirname(__file__), '..', '..'
)
os.makedirs(_STATE_DIR, exist_ok=True)

# Load .env dari STATE_DIR (Railway) atau scraper folder (lokal)
_LOCAL_ENV = os.path.join(os.path.dirname(__file__), '..', '..', '.env')
_STATE_ENV = os.path.join(_STATE_DIR, '.env')
if os.path.exists(_STATE_ENV):
    dotenv.load_dotenv(_STATE_ENV)
elif os.path.exists(_LOCAL_ENV):
    dotenv.load_dotenv(_LOCAL_ENV)

TOKEN_FILE = os.path.join(_STATE_DIR, '.token.json')

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
    "Origin": "https://stockbit.com",
    "Referer": "https://stockbit.com/",
    "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
}


def _decode_jwt_exp(token):
    """Decode JWT payload and return exp timestamp, or None if not parseable."""
    try:
        payload_b64 = token.split('.')[1]
        # Add padding
        payload_b64 += '=' * (4 - len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        return payload.get('exp')
    except Exception:
        return None


class StockbitBaseSpider(scrapy.Spider):
    token = None
    player_id = os.getenv("STOCKBIT_PLAYER_ID", "62f850fb-a3f3-4197-a70f-b9d84d1a77f3")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.session = req.Session()
        self.session.headers.update(BROWSER_HEADERS)

        # Apply proxy dari settings jika aktif
        from stockbit.settings import PROXY_ENABLED, PROXY_URL
        proxy_url = PROXY_URL if PROXY_ENABLED else None
        if proxy_url:
            self.session.proxies = {"http": proxy_url, "https": proxy_url}
            print(f"[PROXY] Using proxy: {proxy_url}")

        self._ensure_token()

    def _ensure_token(self):
        """Load cached token if still valid, otherwise login."""
        cached = self._load_token()
        if cached:
            self.token = cached
            print(f"Menggunakan token tersimpan (expired: {self._token_expiry_str()})")
        else:
            self._login()
            self._save_token()

    def _token_expiry_str(self):
        exp = _decode_jwt_exp(self.token)
        if exp:
            from datetime import datetime
            return datetime.fromtimestamp(exp).strftime('%Y-%m-%d %H:%M:%S')
        return 'unknown'

    def _load_token(self):
        """Load token from file if it exists and is not expired."""
        try:
            with open(TOKEN_FILE, 'r') as f:
                data = json.load(f)
            token = data.get('token')
            if not token:
                return None
            exp = _decode_jwt_exp(token)
            if exp and exp > time.time() + 60:  # 60s buffer
                return token
            print("Token tersimpan sudah expired")
            return None
        except (FileNotFoundError, json.JSONDecodeError, KeyError):
            return None

    def _save_token(self):
        """Save token to file for reuse across spiders."""
        exp = _decode_jwt_exp(self.token)
        data = {'token': self.token, 'exp': exp}
        with open(TOKEN_FILE, 'w') as f:
            json.dump(data, f)
        print(f"Token disimpan ke {TOKEN_FILE} (expired: {self._token_expiry_str()})")

    def _log_response(self, resp, label):
        print(f"[{label}] HTTP {resp.status_code}")
        if resp.status_code != 200:
            print(f"[{label}] Response: {resp.text[:1000]}")

    def _login(self):
        username = input("Masukan email: ") or os.getenv("STOCKBIT_USERNAME")
        password = input("Masukan password: ") or os.getenv("STOCKBIT_PASSWORD")

        login_url = "https://exodus.stockbit.com/login/v6/username"
        login_data = {
            "player_id": self.player_id,
            "user": username,
            "password": password,
        }

        resp = self.session.post(login_url, json=login_data)
        self._log_response(resp, "LOGIN")
        resp.raise_for_status()
        resp_json = resp.json()
        data = resp_json.get("data", {})

        print(f"[LOGIN] Full response: {json.dumps(resp_json, indent=2)[:2000]}")

        login_data_resp = data.get("login")
        new_device = data.get("new_device")

        if login_data_resp:
            self.token = login_data_resp["token_data"]["access"]["token"]
            print("Login berhasil")
        elif new_device:
            multi_factor = new_device["multi_factor"]
            login_token = multi_factor["login_token"]

            # Request OTP to email
            otp_url = "https://exodus.stockbit.com/login/v3/new-device/otp"
            otp_resp = self.session.post(otp_url, json={"channel": "CHANNEL_EMAIL", "token": login_token})
            self._log_response(otp_resp, "OTP_REQUEST")
            otp_resp.raise_for_status()
            print("OTP dikirimkan ke email, mohon cek email anda")

            otp = input("Masukan OTP: ")

            # Verify OTP
            verify_url = "https://exodus.stockbit.com/login/v3/new-device/otp/verify"
            verify_resp = self.session.post(verify_url, json={"otp": otp, "token": login_token})
            self._log_response(verify_resp, "OTP_VERIFY")
            verify_resp.raise_for_status()
            verify_data = verify_resp.json()
            print(f"[OTP_VERIFY] Full response: {json.dumps(verify_data, indent=2)[:2000]}")
            self.token = verify_data["data"]["access"]["token"]
            print("OTP verified, login berhasil")
        else:
            raise RuntimeError(f"Unexpected login response. Data keys: {list(data.keys())}")

    def auth_headers(self):
        return {"Authorization": f"Bearer {self.token}"}
