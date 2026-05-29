import "server-only";
import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { SCRAPER_DIR } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/tickers
 * Baca tickers_saham.json langsung dari scraper folder (selalu fresh after refresh).
 * Returns { tickers, lastModifiedIso, count }.
 */
export async function GET() {
  const file = path.join(SCRAPER_DIR, "tickers_saham.json");
  if (!fs.existsSync(file)) {
    return NextResponse.json(
      { error: "tickers_saham.json tidak ditemukan. Run refresh dulu." },
      { status: 404 },
    );
  }
  const stat = fs.statSync(file);
  const data = JSON.parse(fs.readFileSync(file, "utf-8"));
  return NextResponse.json({
    tickers: data,
    count: data.length,
    lastModifiedIso: stat.mtime.toISOString(),
  });
}
