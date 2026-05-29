import "server-only";
import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { STATE_DIR, SCRAPER_SOURCE_DIR } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/tickers
 * Baca tickers_saham.json. Priority:
 *   1. STATE_DIR (kalau refresh udah pernah dijalanin di server ini)
 *   2. SCRAPER_SOURCE_DIR (initial bootstrap dari image)
 */
export async function GET() {
  const candidates = [
    path.join(STATE_DIR, "tickers_saham.json"),
    path.join(SCRAPER_SOURCE_DIR, "tickers_saham.json"),
  ];
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) {
    return NextResponse.json(
      { error: "tickers_saham.json tidak ditemukan" },
      { status: 404 },
    );
  }
  const stat = fs.statSync(file);
  const data = JSON.parse(fs.readFileSync(file, "utf-8"));
  return NextResponse.json({
    tickers: data,
    count: data.length,
    lastModifiedIso: stat.mtime.toISOString(),
    source: file === candidates[0] ? "state" : "bundled",
  });
}
