"""Download Stockbit company logos for all tickers in symbol.json."""
import json
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

ROOT = Path(__file__).parent
SOURCE = ROOT / "tickers_saham.json"
OUT_DIR = ROOT / "company_logos"
LOG_404 = ROOT / "logos_missing.txt"
LOG_ERR = ROOT / "logos_errors.txt"

URL_TEMPLATE = "https://assets.stockbit.com/logos/companies/{ticker}.png"
MAX_WORKERS = 10
TIMEOUT = 15
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Referer": "https://stockbit.com/",
    "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
}


def load_tickers():
    with open(SOURCE, "r", encoding="utf-8") as f:
        return json.load(f)


def download_one(ticker):
    out = OUT_DIR / f"{ticker}.png"
    if out.exists() and out.stat().st_size > 0:
        return ticker, "skip"
    url = URL_TEMPLATE.format(ticker=ticker)
    try:
        r = requests.get(url, timeout=TIMEOUT, headers=HEADERS)
        if r.status_code == 200 and r.content:
            out.write_bytes(r.content)
            return ticker, "ok"
        if r.status_code == 404:
            return ticker, "404"
        return ticker, f"http_{r.status_code}"
    except Exception as e:
        return ticker, f"err:{type(e).__name__}"


def main():
    OUT_DIR.mkdir(exist_ok=True)
    tickers = load_tickers()
    print(f"[INFO] {len(tickers)} ticker akan dicoba download (skip yang udah ada)")

    ok = skip = missing = err = 0
    missing_list, err_list = [], []

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(download_one, row["ticker"]): row for row in tickers}
        for i, fut in enumerate(as_completed(futures), 1):
            ticker, status = fut.result()
            if status == "ok":
                ok += 1
            elif status == "skip":
                skip += 1
            elif status == "404":
                missing += 1
                missing_list.append(ticker)
            else:
                err += 1
                err_list.append(f"{ticker}\t{status}")
            if i % 100 == 0:
                print(f"[PROG] {i}/{len(tickers)} | ok={ok} skip={skip} 404={missing} err={err}")

    print(f"\n[DONE] total={len(tickers)} ok={ok} skip={skip} 404={missing} err={err}")
    print(f"[OUT] {OUT_DIR}")
    if missing_list:
        LOG_404.write_text("\n".join(sorted(missing_list)), encoding="utf-8")
        print(f"[LOG] 404 list -> {LOG_404}")
    if err_list:
        LOG_ERR.write_text("\n".join(err_list), encoding="utf-8")
        print(f"[LOG] error list -> {LOG_ERR}")


if __name__ == "__main__":
    main()
