# Scrapebit

Tools selective scrape Stockbit — pilih ticker, tahun, field, format. UI Next.js
yang spawn scrapy spider lokal di scraper folder.

**Local-only.** Bukan SaaS. Jalannya di laptop yang udah punya
[stockbit-scraper](#dependency-stockbit-scraper) terinstall + login Stockbit.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind 4
- Node child_process untuk spawn scrapy + python subprocess
- File-backed job tracker (no DB) — state di `<scraper>/scrapebit-jobs/<jobId>/`

## Dependency: stockbit-scraper

Scrapebit nge-spawn scrapy dari path hardcoded di `lib/config.ts`:

```ts
export const SCRAPER_DIR = "D:\\Claude-Projects\\Data\\Market Data Sheet\\stockbit-scraper";
```

Folder itu harus punya:
- `venv/Scripts/scrapy.exe` + `venv/Scripts/python.exe` — Python venv dengan
  scrapy + openpyxl + requests + dotenv installed
- `stockbit/spiders/stockbit.py` + `stockbit_quarterly.py` — spider definitions
- `login_token.py` — non-interactive auth (bashid: bikin 2026-05-28)
- `scrapebit_convert.py` — JSON → Excel/CSV converter (bashid: bikin 2026-05-29)
- `tickers_saham.json` — daftar saham bersih hasil `filter_saham.py`
- `.env` dengan `STOCKBIT_USERNAME` + `STOCKBIT_PASSWORD`

Update path-nya di `lib/config.ts` kalau scraper lo di tempat lain.

## Run

```bash
npm install
npm run dev
# buka http://localhost:3000
```

## Fitur

- **Ticker picker** — search by ticker/nama/sektor, multi-select, sector
  quick-chips (Financials 107, Energy 92, dll), `select all matching` + invert
  + clear
- **Periode** (multi-select) — Annual & Quarterly. Default both = full snapshot.
  Spawn sequential (annual dulu, then quarterly).
- **Range tahun** — 2010–current. Post-filter periode di output.
- **Field selector** — Income Statement (wajib), Balance Sheet, Cash Flow,
  Dividend, Key Stats, Emitten Info, Price Performance. Skip = save waktu.
- **Format output** — JSON / Excel (2 sheet: Annual + Quarterly, grouped by
  section) / CSV (long format).
- **Auth banner** — cek `.token.json` exp tiap 60s. Login modal: email+password,
  OTP flow kalau new device.
- **Refresh ticker** — spawn `scrapy crawl symbol` + `process_symbols.py` +
  `filter_saham.py`. Auto-reload list pas selesai.
- **Job panel** — phase indicator (annual/quarterly), progress bar combined,
  log tail (real-time), download per-period.

## API surface

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/auth/status` | GET | Cek validity token Stockbit dari `.token.json` |
| `/api/auth/login` | POST | Login (mode `direct`/`awaiting_otp`) atau verify OTP |
| `/api/tickers` | GET | Reload ticker list dari scraper folder |
| `/api/refresh-tickers` | POST | Spawn symbol crawl + filter chain, return jobId |
| `/api/scrape` | POST | Spawn scrapy chain dengan config, return jobId |
| `/api/scrape/[jobId]/status` | GET | State + progress + log tail (polled 2s) |
| `/api/scrape/[jobId]/download?file=...` | GET | Serve output file |

## Workflow contoh

**Snapshot full data untuk 5 saham bank:**
1. Klik chip `Financials 107`
2. Search tambahan: `BBCA` (chip auto-cleared, search box terisi)
3. ✓ select all matching (kalau mau bulk) atau pilih satu-satu
4. ✓ Annual ✓ Quarterly
5. Year 2020–2026
6. Pilih field yang diperluin (IS+BS+CF udah default)
7. Format Excel
8. Start
9. Tunggu 1-3 menit (5 ticker × 2 spider)
10. Download `output_annual.xlsx` + `output_quarterly.xlsx`

## Catatan

- **Windows path with spaces**: Backend pakai Node-native sequential spawn
  (no `cmd /c` chaining) karena cmd.exe quote escaping rusak path scraper
  yang ada spasi
- **Stockbit format quarterly**: Per fix 2026-05-28, format period diskret
  (`Q126`, `Q425`) bukan cumulative YTD (`3M25`, `6M25`). Spider udah handle
  keduanya
- **Output converter**: `scrapebit_convert.py` di scraper folder, split jadi
  2 sheet Excel (Annual + Quarterly), group by section (IS/BS/CF/Ratios)

## Deploy ke Railway

Scrapebit punya Dockerfile self-contained — scraper source di-bundle ke
`scrapy-bundle/`, runtime state di volume mount `/data`.

### Setup pertama kali

1. **Create project** di Railway → connect repo `bashideffendi/scrapebit`.
2. **Add volume**: Settings → Volumes → New volume, mount path `/data`,
   size 1 GB (cukup buat output beberapa scrape full).
3. **Set env vars** (Settings → Variables):
   - `STOCKBIT_USERNAME` — email/username Stockbit
   - `STOCKBIT_PASSWORD` — password
   - `STOCKBIT_PLAYER_ID` — *kosongin*, default UUID dipake. Stockbit bakal
     anggap "new device" pertama kali → OTP needed
   - (optional) `STATE_DIR=/data`, `SCRAPER_SOURCE_DIR=/app/scrapy-bundle` —
     udah default di Dockerfile, gak perlu di-set kecuali pengen override
4. **Deploy** — Railway auto-build dari Dockerfile.
5. **First OTP** — buka app URL, banner amber muncul "● new device · login".
   Klik → login form jalan: email/password (dari env atau ketik manual) →
   pilih channel (Email / WA / SMS sesuai apa yg Stockbit tawarin) → masukin
   OTP → verified. Token cached 24h di `/data/.token.json`.

### Catatan Railway

- **Re-OTP tiap 24h**: Token Stockbit expire harian. Banner amber muncul lagi.
- **Cold start**: First request after sleep nyalain container — ~10-20 detik
- **Build time**: ~3-5 menit (multi-stage Docker, npm ci + pip install)
- **Image size**: ~400 MB (Node + Python + scrapy + openpyxl)
- **Free tier**: $5/bulan credit, build kira-kira 1-2 menit credit per deploy,
  runtime tergantung traffic. Idle banget — cukup buat personal use.
- **Custom domain**: Railway → Settings → Domains → add `scrapebit.masbash.id`,
  CNAME ke Railway domain di provider DNS

### Test local build sebelum push Railway

```bash
docker build -t scrapebit:test .
docker run --rm \
  -p 3000:3000 \
  -v scrapebit-data:/data \
  -e STOCKBIT_USERNAME=... \
  -e STOCKBIT_PASSWORD=... \
  scrapebit:test
# buka http://localhost:3000
```

### Architecture path

Local dev (Windows):
- `SCRAPER_SOURCE_DIR` = `D:\Claude-Projects\Data\Market Data Sheet\stockbit-scraper`
- `STATE_DIR` = same (single folder buat source + state)
- `PYTHON_BIN` / `SCRAPY_BIN` = venv binaries

Docker (Railway):
- `SCRAPER_SOURCE_DIR` = `/app/scrapy-bundle` (read-only, bundled di image)
- `STATE_DIR` = `/data` (persistent volume — `.token.json`, `tickers_saham.json`,
  `scrapebit-jobs/`, `.env`)
- `PYTHON_BIN` = `/usr/local/bin/python3` (system Python)
- `SCRAPY_BIN` = `/usr/local/bin/scrapy` (pip-installed)
