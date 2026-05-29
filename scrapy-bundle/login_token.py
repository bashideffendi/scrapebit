"""
Standalone Stockbit login dengan multi-channel + multi-step verification support.

Mode operasi:
    python login_token.py                          # initial login pakai env creds
    python login_token.py --probe                  # probe channels available
    python login_token.py --request-otp <channel>  # request OTP via channel
                                                   #   CHANNEL_EMAIL | CHANNEL_WHATSAPP | CHANNEL_SMS
    python login_token.py --otp 123456             # verify OTP (channel terakhir)

State file: `.login_state.json` di scraper folder simpen login_token + cookies
+ probed channels antar invocations.

Output JSON di stdout (untuk parse-friendly konsumsi dari API):
    {"mode": "direct", "ok": true}
    {"mode": "awaiting_otp", "channels": ["CHANNEL_EMAIL","CHANNEL_WHATSAPP"], "preview": "...@gmail.com"}
    {"mode": "otp_sent", "channel": "CHANNEL_WHATSAPP", "preview": "+62***"}
    {"mode": "otp_verified", "ok": true}
    {"error": "...", "stdout": "..."}
"""

import argparse
import base64
import json
import os
import sys
from datetime import datetime
from pathlib import Path

import dotenv
import requests

ROOT = Path(__file__).parent
# State directory — Docker/Railway: /data, lokal: scraper folder.
# Env override via SCRAPEBIT_STATE_DIR. Default: ROOT (lokal).
STATE_DIR = Path(os.environ.get("SCRAPEBIT_STATE_DIR") or ROOT)
STATE_DIR.mkdir(parents=True, exist_ok=True)

# .env bisa di STATE_DIR (Railway) atau ROOT (lokal)
for env_path in (STATE_DIR / ".env", ROOT / ".env"):
    if env_path.exists():
        dotenv.load_dotenv(env_path)
        break

TOKEN_FILE = STATE_DIR / ".token.json"
STATE_FILE = STATE_DIR / ".login_state.json"

PLAYER_ID = os.getenv("STOCKBIT_PLAYER_ID") or "62f850fb-a3f3-4197-a70f-b9d84d1a77f3"
USERNAME = os.getenv("STOCKBIT_USERNAME")
PASSWORD = os.getenv("STOCKBIT_PASSWORD")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
    "Origin": "https://stockbit.com",
    "Referer": "https://stockbit.com/",
    "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
}

KNOWN_CHANNELS = ["CHANNEL_EMAIL", "CHANNEL_WHATSAPP", "CHANNEL_SMS"]


def emit(payload: dict) -> None:
    """Emit JSON to stdout — konsumsi dari API."""
    print(json.dumps(payload))


def fail(msg: str, extra: dict | None = None) -> None:
    emit({"error": msg, **(extra or {})})
    sys.exit(1)


def decode_exp(token: str) -> int:
    payload_b64 = token.split(".")[1]
    payload_b64 += "=" * (4 - len(payload_b64) % 4)
    payload = json.loads(base64.urlsafe_b64decode(payload_b64))
    return payload.get("exp", 0)


def save_token(token: str) -> None:
    exp = decode_exp(token)
    TOKEN_FILE.write_text(json.dumps({"token": token, "exp": exp}))


def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except json.JSONDecodeError:
            return {}
    return {}


def save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state))


def make_session(state: dict | None = None) -> requests.Session:
    s = requests.Session()
    s.headers.update(HEADERS)
    if state and state.get("cookies"):
        s.cookies.update(state["cookies"])
    return s


def extract_channels(new_device: dict) -> list[str]:
    """Coba detect channels available dari berbagai shape response Stockbit.
    Fallback ke KNOWN_CHANNELS kalau ga ketemu structure-nya.
    """
    mf = new_device.get("multi_factor") or {}
    # Try common paths
    for key in ("channels", "available_channels", "methods"):
        v = mf.get(key)
        if isinstance(v, list) and v:
            return [str(c) for c in v]
    # Try `factors` list with type
    factors = mf.get("factors") or new_device.get("factors")
    if isinstance(factors, list) and factors:
        out = []
        for f in factors:
            if isinstance(f, dict):
                c = f.get("channel") or f.get("type")
                if c:
                    out.append(str(c))
        if out:
            return out
    return KNOWN_CHANNELS.copy()  # fallback


def initial_login() -> None:
    if not USERNAME or not PASSWORD:
        fail("STOCKBIT_USERNAME / STOCKBIT_PASSWORD belum ada di .env")

    s = make_session()
    r = s.post(
        "https://exodus.stockbit.com/login/v6/username",
        json={"player_id": PLAYER_ID, "user": USERNAME, "password": PASSWORD},
    )
    if r.status_code != 200:
        fail(f"HTTP {r.status_code}", {"body": r.text[:500]})

    data = (r.json() or {}).get("data") or {}
    login = data.get("login")
    new_device = data.get("new_device")

    if login:
        token = login["token_data"]["access"]["token"]
        save_token(token)
        if STATE_FILE.exists():
            STATE_FILE.unlink()
        emit({
            "mode": "direct",
            "ok": True,
            "expiresAt": datetime.fromtimestamp(decode_exp(token)).isoformat(),
        })
        return

    if new_device:
        mf = new_device.get("multi_factor") or {}
        login_token = mf.get("login_token")
        channels = extract_channels(new_device)
        # Preview info (mask, email/phone target)
        preview = mf.get("preview") or new_device.get("contact") or {}

        state = {
            "login_token": login_token,
            "cookies": dict(s.cookies),
            "channels_available": channels,
            "channels_completed": [],
            "raw_response": data,  # save buat debug
        }
        save_state(state)

        emit({
            "mode": "awaiting_channel",
            "channels": channels,
            "preview": preview,
        })
        return

    fail("Unexpected response shape", {"data_keys": list(data.keys())})


def request_otp(channel: str) -> None:
    state = load_state()
    login_token = state.get("login_token")
    if not login_token:
        fail("No pending login state — jalanin initial login dulu (no args)")

    if channel not in state.get("channels_available", KNOWN_CHANNELS):
        # Allow anyway — Stockbit might accept channels not advertised
        pass

    s = make_session(state)
    r = s.post(
        "https://exodus.stockbit.com/login/v3/new-device/otp",
        json={"channel": channel, "token": login_token},
    )
    if r.status_code != 200:
        fail(
            f"HTTP {r.status_code} request OTP",
            {"channel": channel, "body": r.text[:500]},
        )

    # Update cookies + remember last channel
    state["cookies"] = dict(s.cookies)
    state["last_channel"] = channel
    save_state(state)

    body = r.json() or {}
    preview = (body.get("data") or {}).get("preview") or {}
    emit({
        "mode": "otp_sent",
        "channel": channel,
        "preview": preview,
        "channelsRemaining": [
            c for c in state.get("channels_available", [])
            if c != channel and c not in state.get("channels_completed", [])
        ],
    })


def verify_otp(otp: str) -> None:
    state = load_state()
    login_token = state.get("login_token")
    last_channel = state.get("last_channel")
    if not login_token or not last_channel:
        fail("No pending OTP state — request OTP dulu pakai --request-otp <channel>")

    s = make_session(state)
    r = s.post(
        "https://exodus.stockbit.com/login/v3/new-device/otp/verify",
        json={"otp": otp, "token": login_token, "channel": last_channel},
    )
    if r.status_code != 200:
        fail(f"HTTP {r.status_code} verify OTP", {"body": r.text[:500]})

    body = r.json() or {}
    data = body.get("data") or {}

    # 3 possible outcomes:
    # 1. access.token → done
    # 2. new login_token + multi-step needed → continue with another channel
    # 3. error
    access = data.get("access") or (data.get("login") or {}).get("token_data", {}).get("access")
    if access and access.get("token"):
        token = access["token"]
        save_token(token)
        if STATE_FILE.exists():
            STATE_FILE.unlink()
        emit({
            "mode": "otp_verified",
            "ok": True,
            "expiresAt": datetime.fromtimestamp(decode_exp(token)).isoformat(),
        })
        return

    # Multi-step: Stockbit kasih login_token baru + next channel required
    next_step = data.get("next") or data.get("multi_factor")
    if next_step:
        new_login_token = (
            next_step.get("login_token") if isinstance(next_step, dict) else None
        )
        if new_login_token:
            state["login_token"] = new_login_token
            state["cookies"] = dict(s.cookies)
            state["channels_completed"] = state.get("channels_completed", []) + [last_channel]
            new_channels = extract_channels({"multi_factor": next_step})
            remaining = [
                c for c in new_channels if c not in state["channels_completed"]
            ]
            state["channels_available"] = remaining or new_channels
            save_state(state)
            emit({
                "mode": "awaiting_next_factor",
                "channelsCompleted": state["channels_completed"],
                "channelsRemaining": remaining or new_channels,
            })
            return

    fail("OTP verified tapi response shape gak dikenal", {"data_keys": list(data.keys())})


def probe() -> None:
    """Just trigger initial login + return channels tanpa state side-effect."""
    if not USERNAME or not PASSWORD:
        fail("STOCKBIT_USERNAME / STOCKBIT_PASSWORD belum ada di .env")
    s = make_session()
    r = s.post(
        "https://exodus.stockbit.com/login/v6/username",
        json={"player_id": PLAYER_ID, "user": USERNAME, "password": PASSWORD},
    )
    if r.status_code != 200:
        fail(f"HTTP {r.status_code}", {"body": r.text[:500]})
    data = (r.json() or {}).get("data") or {}
    if data.get("login"):
        emit({"mode": "no_verification_needed"})
        return
    if data.get("new_device"):
        emit({
            "mode": "verification_needed",
            "channels": extract_channels(data["new_device"]),
        })
        return
    fail("Unexpected response", {"keys": list(data.keys())})


def main() -> None:
    p = argparse.ArgumentParser()
    g = p.add_mutually_exclusive_group()
    g.add_argument("--probe", action="store_true", help="Probe verification requirement")
    g.add_argument("--request-otp", metavar="CHANNEL", help="Request OTP via channel")
    g.add_argument("--otp", metavar="CODE", help="Verify OTP code")
    args = p.parse_args()

    try:
        if args.probe:
            probe()
        elif args.request_otp:
            request_otp(args.request_otp)
        elif args.otp:
            verify_otp(args.otp)
        else:
            initial_login()
    except requests.RequestException as e:
        fail(f"Network error: {e}")


if __name__ == "__main__":
    main()
