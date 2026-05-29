import tickersRaw from "@/data/tickers.json";
import type { Ticker } from "@/lib/config";
import { ScraperShell } from "./scraper-shell";

export default function Home() {
  // Initial render pakai static copy (instant). Client effect reload dari API
  // dengan fresh data dari scraper folder.
  const initialTickers = tickersRaw as Ticker[];
  return <ScraperShell initialTickers={initialTickers} />;
}
