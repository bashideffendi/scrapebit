import "server-only";
import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  SCRAPER_DIR,
  SCRAPY_BIN,
  PYTHON_BIN,
  type JobStatus,
} from "@/lib/config";
import {
  ensureJobsDir,
  jobDir,
  logFile,
  newJobId,
  writeState,
} from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/refresh-tickers
 * Chain sequential: scrapy crawl symbol → process_symbols.py → filter_saham.py.
 * Same pattern as /api/scrape — Node-native spawn (no cmd /c).
 */
export async function POST() {
  ensureJobsDir();
  const jobId = `refresh-${newJobId()}`;
  fs.mkdirSync(jobDir(jobId), { recursive: true });

  const state: JobStatus = {
    jobId,
    state: "running",
    startedAt: Date.now(),
    endedAt: null,
    progress: { current: 0, total: 100 },
    currentPhase: null,
    logTail: [],
    outputs: [],
    error: null,
    config: {
      tickers: [],
      yearFrom: 0,
      yearTo: 0,
      fields: [],
      periods: [],
      format: "json",
    },
  };
  writeState(jobId, state);

  void runRefresh(jobId);

  return NextResponse.json({ jobId });
}

async function runRefresh(jobId: string): Promise<void> {
  const log = logFile(jobId);
  const symbolJson = path.join(SCRAPER_DIR, "symbol.json");

  try {
    fs.appendFileSync(log, "[REFRESH] Step 1/3: scrapy crawl symbol\n");
    if (fs.existsSync(symbolJson)) fs.unlinkSync(symbolJson);
    await runOnce(SCRAPY_BIN, ["crawl", "symbol", "-o", symbolJson], log);

    fs.appendFileSync(log, "[REFRESH] Step 2/3: process_symbols.py\n");
    await runOnce(PYTHON_BIN, ["process_symbols.py"], log);

    fs.appendFileSync(log, "[REFRESH] Step 3/3: filter_saham.py\n");
    await runOnce(PYTHON_BIN, ["filter_saham.py"], log);

    fs.appendFileSync(log, "[REFRESH] Done\n");
    markState(jobId, "done", null);
  } catch (err) {
    fs.appendFileSync(log, `\n[REFRESH] FAILED: ${err}\n`);
    markState(jobId, "failed", String(err));
  }
}

function runOnce(bin: string, args: string[], logPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = fs.openSync(logPath, "a");
    const child = spawn(bin, args, {
      cwd: SCRAPER_DIR,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      stdio: ["ignore", stream, stream],
      windowsHide: true,
    });
    child.on("exit", (code) => {
      fs.closeSync(stream);
      if (code === 0) resolve();
      else reject(new Error(`exit code ${code}`));
    });
    child.on("error", (err) => {
      fs.closeSync(stream);
      reject(err);
    });
  });
}

function markState(jobId: string, state: "done" | "failed", error: string | null) {
  try {
    const stateFile = path.join(jobDir(jobId), "state.json");
    const cur = JSON.parse(fs.readFileSync(stateFile, "utf-8")) as JobStatus;
    cur.state = state;
    cur.endedAt = Date.now();
    cur.error = error;
    fs.writeFileSync(stateFile, JSON.stringify(cur, null, 2));
  } catch {
    // ignore
  }
}
