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
 * Body: { email?, password?, otp? }
 *
 * 2 modes:
 *  1. Initial login: { email, password } — kirim ke login_token.py via env override.
 *     Result: success → token saved; new_device → returns awaiting_otp.
 *  2. Verify OTP: { otp } — login_token.py --otp <kode>.
 *
 * Krn login_token.py baca dari .env, mode 1 kita override env STOCKBIT_USERNAME/PASSWORD
 * dengan spawn env. Mode 2 langsung pass --otp arg.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    otp?: string;
  };

  const script = path.join(SCRAPER_DIR, "login_token.py");
  if (!fs.existsSync(script)) {
    return NextResponse.json(
      { error: "login_token.py tidak ditemukan di scraper folder" },
      { status: 500 },
    );
  }

  // Mode 2: verify OTP
  if (body.otp) {
    const r = spawnSync(PYTHON_BIN, [script, "--otp", body.otp], {
      cwd: SCRAPER_DIR,
      env: process.env,
      encoding: "utf-8",
      timeout: 30000,
    });
    const stdout = r.stdout || "";
    const stderr = r.stderr || "";
    if (r.status === 0 && /\[OK\] OTP verified/.test(stdout)) {
      return NextResponse.json({ ok: true, mode: "otp_verified" });
    }
    return NextResponse.json(
      { error: "OTP verify gagal", stdout, stderr },
      { status: 400 },
    );
  }

  // Mode 1: initial login
  if (!body.email || !body.password) {
    return NextResponse.json(
      { error: "email + password required" },
      { status: 400 },
    );
  }

  const env = {
    ...process.env,
    STOCKBIT_USERNAME: body.email,
    STOCKBIT_PASSWORD: body.password,
  };
  const r = spawnSync(PYTHON_BIN, [script], {
    cwd: SCRAPER_DIR,
    env,
    encoding: "utf-8",
    timeout: 30000,
  });
  const stdout = r.stdout || "";
  const stderr = r.stderr || "";

  if (r.status === 0 && /\[OK\] Login direct success/.test(stdout)) {
    return NextResponse.json({ ok: true, mode: "direct" });
  }
  if (r.status === 0 && /\[OTP\] State saved/.test(stdout)) {
    return NextResponse.json({ ok: true, mode: "awaiting_otp" });
  }
  return NextResponse.json(
    { error: "Login gagal", stdout, stderr },
    { status: 400 },
  );
}
