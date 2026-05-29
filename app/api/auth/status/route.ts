import "server-only";
import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { STATE_DIR } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/status
 * Cek validity Stockbit token dari .token.json di STATE_DIR.
 * Format: { token, exp } — exp unix timestamp seconds.
 */
export async function GET() {
  try {
    const tokenFile = path.join(STATE_DIR, ".token.json");
    if (!fs.existsSync(tokenFile)) {
      return NextResponse.json({ valid: false, reason: "no_token" });
    }
    const raw = JSON.parse(fs.readFileSync(tokenFile, "utf-8")) as {
      token?: string;
      exp?: number;
    };
    if (!raw.token || !raw.exp) {
      return NextResponse.json({ valid: false, reason: "malformed" });
    }
    const now = Math.floor(Date.now() / 1000);
    const remainingSec = raw.exp - now;
    if (remainingSec <= 0) {
      return NextResponse.json({
        valid: false,
        reason: "expired",
        exp: raw.exp,
        expiredAtIso: new Date(raw.exp * 1000).toISOString(),
      });
    }
    return NextResponse.json({
      valid: true,
      exp: raw.exp,
      expiresAtIso: new Date(raw.exp * 1000).toISOString(),
      remainingSec,
    });
  } catch (err) {
    return NextResponse.json(
      { valid: false, reason: "error", error: String(err) },
      { status: 500 },
    );
  }
}
