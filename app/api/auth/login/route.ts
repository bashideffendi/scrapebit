import "server-only";
import { NextResponse } from "next/server";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { SCRAPER_DIR, PYTHON_BIN } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/login
 * Body variants:
 *  1. { email, password }              → initial login (mungkin direct or trigger verification)
 *  2. { requestOtp: "CHANNEL_EMAIL" }  → minta OTP dikirim via channel
 *  3. { otp: "123456" }                → verify OTP
 *
 * Returns:
 *  - { mode: "direct", ok, expiresAt }              ← login langsung, ga butuh OTP
 *  - { mode: "awaiting_channel", channels: [...] }  ← need pilih channel
 *  - { mode: "otp_sent", channel, channelsRemaining } ← OTP terkirim
 *  - { mode: "otp_verified", ok, expiresAt }        ← OTP valid, login complete
 *  - { mode: "awaiting_next_factor", channelsCompleted, channelsRemaining } ← multi-step
 *  - { error, ... }
 *
 * All structured JSON output diparse dari login_token.py stdout.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    requestOtp?: string; // channel name
    otp?: string;
  };

  const script = path.join(SCRAPER_DIR, "login_token.py");
  if (!fs.existsSync(script)) {
    return NextResponse.json(
      { error: "login_token.py tidak ditemukan di scraper folder" },
      { status: 500 },
    );
  }

  let args: string[];
  let env = process.env;

  if (body.otp) {
    args = [script, "--otp", body.otp];
  } else if (body.requestOtp) {
    args = [script, "--request-otp", body.requestOtp];
  } else if (body.email && body.password) {
    args = [script];
    env = {
      ...process.env,
      STOCKBIT_USERNAME: body.email,
      STOCKBIT_PASSWORD: body.password,
    };
  } else {
    return NextResponse.json(
      { error: "Pass {email,password} or {requestOtp:channel} or {otp:code}" },
      { status: 400 },
    );
  }

  const r = spawnSync(PYTHON_BIN, args, {
    cwd: SCRAPER_DIR,
    env,
    encoding: "utf-8",
    timeout: 30000,
  });
  const stdout = (r.stdout || "").trim();
  const stderr = (r.stderr || "").trim();

  // Parse the LAST line as JSON (script emits structured JSON)
  const lastLine = stdout.split("\n").filter((l) => l.trim()).pop() || "";
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(lastLine);
  } catch {
    return NextResponse.json(
      {
        error: "Script output not JSON",
        stdout,
        stderr,
        exitCode: r.status,
      },
      { status: 500 },
    );
  }

  if (parsed && "error" in parsed) {
    return NextResponse.json(
      { ...parsed, stderr: stderr || undefined },
      { status: 400 },
    );
  }
  return NextResponse.json(parsed);
}
