#!/bin/sh
# Bootstrap STATE_DIR pas container pertama jalan.
# Idempotent — kalau file udah ada di volume, skip copy.

set -e

STATE_DIR=${STATE_DIR:-/data}
SCRAPER_SOURCE_DIR=${SCRAPER_SOURCE_DIR:-/app/scrapy-bundle}

mkdir -p "$STATE_DIR"
mkdir -p "$STATE_DIR/scrapebit-jobs"

# Copy initial tickers_saham.json kalau belum ada di volume
if [ ! -f "$STATE_DIR/tickers_saham.json" ] && [ -f "$SCRAPER_SOURCE_DIR/tickers_saham.json" ]; then
  echo "[BOOT] Copying initial tickers_saham.json -> $STATE_DIR"
  cp "$SCRAPER_SOURCE_DIR/tickers_saham.json" "$STATE_DIR/tickers_saham.json"
fi

# Touch .env kalau belum ada (user nanti edit via Railway UI atau secret)
if [ ! -f "$STATE_DIR/.env" ]; then
  echo "# Set STOCKBIT_USERNAME and STOCKBIT_PASSWORD here, or via Railway env vars" > "$STATE_DIR/.env"
fi

echo "[BOOT] State dir: $STATE_DIR"
echo "[BOOT] Source dir: $SCRAPER_SOURCE_DIR"
echo "[BOOT] Starting: $@"
exec "$@"
