/**
 * Scrapebit shared config — paths, types, constants.
 * Local-only app. Spawn scrapy yang udah di-install di scraper folder.
 */

import path from "node:path";

/** Absolute path ke scraper folder. Spawn scrapy dari sini. */
export const SCRAPER_DIR =
  "D:\\Claude-Projects\\Data\\Market Data Sheet\\stockbit-scraper";

/** Path ke scrapy.exe di venv. */
export const SCRAPY_BIN = path.join(SCRAPER_DIR, "venv", "Scripts", "scrapy.exe");

/** Path ke python.exe di venv (buat parse-excel post-process kalau format=excel). */
export const PYTHON_BIN = path.join(SCRAPER_DIR, "venv", "Scripts", "python.exe");

/** Folder buat output job + log per scrape. */
export const JOBS_DIR = path.join(SCRAPER_DIR, "scrapebit-jobs");

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
  tickers: string[];          // ["BBCA","BBRI",...]
  yearFrom: number;           // e.g. 2020
  yearTo: number;             // e.g. 2026
  fields: ScrapeFieldId[];    // ["income_statement","balance_sheet"]
  periods: PeriodType[];      // ["annual","quarterly"] — multi-select, min 1
  format: OutputFormat;       // "json" | "excel" | "csv"
}

export interface OutputFile {
  period: PeriodType;
  filename: string;           // e.g. "output_annual.json"
  sizeBytes: number;
}

export interface JobStatus {
  jobId: string;
  state: "queued" | "running" | "done" | "failed";
  startedAt: number;
  endedAt: number | null;
  /** Combined progress across all periods (current/total ticker, sum across phases). */
  progress: { current: number; total: number };
  /** Current phase if multi-period (annual / quarterly). */
  currentPhase: PeriodType | null;
  logTail: string[];          // last 20 lines
  outputs: OutputFile[];      // populated as each spider finishes
  error: string | null;
  config: ScrapeRequest;
}

export interface Ticker {
  ticker: string;
  name: string;
  sectors: string[];
  subsectors: string[];
}
