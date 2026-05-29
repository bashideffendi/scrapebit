/**
 * Scrapebit shared config.
 *
 * Path resolution (env-overridable buat Docker/Railway):
 *   SCRAPER_SOURCE_DIR — readonly source code (spiders, scripts, requirements).
 *     Default: D:\Claude-Projects\Data\Market Data Sheet\stockbit-scraper (lokal Bashid).
 *     Docker: /app/scrapy-bundle (bundled di image)
 *   STATE_DIR — writable runtime state (.token.json, tickers_saham.json, jobs).
 *     Default: same as SCRAPER_SOURCE_DIR (lokal).
 *     Docker: /data (persistent volume mount).
 *   PYTHON_BIN — path ke python.exe / python3 executable.
 *     Default: <SCRAPER_SOURCE_DIR>/venv/Scripts/python.exe (lokal Windows venv).
 *     Docker: /usr/bin/python3 (system Python).
 *   SCRAPY_BIN — path ke scrapy executable.
 *     Default: <SCRAPER_SOURCE_DIR>/venv/Scripts/scrapy.exe (lokal venv).
 *     Docker: /usr/local/bin/scrapy (pip-installed system-wide).
 */

import path from "node:path";

const DEFAULT_SCRAPER_DIR =
  "D:\\Claude-Projects\\Data\\Market Data Sheet\\stockbit-scraper";

export const SCRAPER_SOURCE_DIR =
  process.env.SCRAPER_SOURCE_DIR || DEFAULT_SCRAPER_DIR;

export const STATE_DIR = process.env.STATE_DIR || SCRAPER_SOURCE_DIR;

export const PYTHON_BIN =
  process.env.PYTHON_BIN ||
  path.join(SCRAPER_SOURCE_DIR, "venv", "Scripts", "python.exe");

export const SCRAPY_BIN =
  process.env.SCRAPY_BIN ||
  path.join(SCRAPER_SOURCE_DIR, "venv", "Scripts", "scrapy.exe");

/** Backward-compat alias — beberapa file lama pakai SCRAPER_DIR; sekarang itu = source. */
export const SCRAPER_DIR = SCRAPER_SOURCE_DIR;

/** Folder buat output job + log per scrape. Di STATE_DIR biar persistent. */
export const JOBS_DIR = path.join(STATE_DIR, "scrapebit-jobs");

/** Available scrape fields (endpoint groups). */
export const SCRAPE_FIELDS = [
  { id: "income_statement", label: "Income Statement", required: true },
  { id: "balance_sheet", label: "Balance Sheet", required: false },
  { id: "cash_flow", label: "Cash Flow", required: false },
  { id: "dividend", label: "Dividend (annual only)", required: false },
  { id: "keystats", label: "Key Stats Raw (annual only)", required: false },
  { id: "emitten_info", label: "Emitten Info (annual only)", required: false },
  { id: "price_performance", label: "Price Performance (annual only)", required: false },
] as const;

export type ScrapeFieldId = (typeof SCRAPE_FIELDS)[number]["id"];

export const OUTPUT_FORMATS = [
  { id: "json", label: "JSON", ext: "json" },
  { id: "excel", label: "Excel (.xlsx)", ext: "xlsx" },
  { id: "csv", label: "CSV", ext: "csv" },
] as const;

export type OutputFormat = (typeof OUTPUT_FORMATS)[number]["id"];

export const PERIOD_TYPES = [
  { id: "annual", label: "Annual (per tahun)" },
  { id: "quarterly", label: "Quarterly (per kuartal)" },
] as const;

export type PeriodType = (typeof PERIOD_TYPES)[number]["id"];

export interface ScrapeRequest {
  tickers: string[];
  yearFrom: number;
  yearTo: number;
  fields: ScrapeFieldId[];
  periods: PeriodType[];
  format: OutputFormat;
}

export interface OutputFile {
  period: PeriodType;
  filename: string;
  sizeBytes: number;
}

export interface JobStatus {
  jobId: string;
  state: "queued" | "running" | "done" | "failed";
  startedAt: number;
  endedAt: number | null;
  progress: { current: number; total: number };
  currentPhase: PeriodType | null;
  logTail: string[];
  outputs: OutputFile[];
  error: string | null;
  config: ScrapeRequest;
}

export interface Ticker {
  ticker: string;
  name: string;
  sectors: string[];
  subsectors: string[];
}
