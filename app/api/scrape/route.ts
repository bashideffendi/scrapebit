import "server-only";
import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  SCRAPER_DIR,
  SCRAPY_BIN,
  PYTHON_BIN,
  type OutputFormat,
  type PeriodType,
  type ScrapeRequest,
  type JobStatus,
} from "@/lib/config";
import {
  ensureJobsDir,
  jobDir,
  logFile,
  newJobId,
  outputFileForPeriod,
  symbolFile,
  writeState,
} from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/scrape
 * Body: ScrapeRequest dengan periods: ["annual","quarterly"] multi-select.
 *
 * Sequential spawn — Node-native, no cmd /c chaining (Windows quote hell).
 * Async fire-and-forget: runChain berjalan di background setelah response return.
 */
export async function POST(req: Request) {
  const body = (await req.json()) as ScrapeRequest;

  if (!body.tickers?.length) {
    return NextResponse.json({ error: "No tickers selected" }, { status: 400 });
  }
  if (!body.fields?.length) {
    return NextResponse.json({ error: "No fields selected" }, { status: 400 });
  }
  if (!body.periods?.length) {
    return NextResponse.json({ error: "No periods selected" }, { status: 400 });
  }

  ensureJobsDir();
  const jobId = newJobId();
  fs.mkdirSync(jobDir(jobId), { recursive: true });

  const symbolList = body.tickers.map((t) => ({ ticker: t, name: t }));
  fs.writeFileSync(symbolFile(jobId), JSON.stringify(symbolList, null, 2));

  const skipEndpoints = computeSkipped(body.fields);
  const yearsArg = `${body.yearFrom}-${body.yearTo}`;

  const state: JobStatus = {
    jobId,
    state: "running",
    startedAt: Date.now(),
    endedAt: null,
    progress: { current: 0, total: body.tickers.length * body.periods.length },
    currentPhase: null,
    logTail: [],
    outputs: [],
    error: null,
    config: body,
  };
  writeState(jobId, state);

  // Header log
  const log = logFile(jobId);
  fs.appendFileSync(
    log,
    `[SCRAPEBIT] periods=${body.periods.join(",")} tickers=${body.tickers.length} years=${yearsArg}\n`,
  );

  // Fire and forget — runChain berjalan di background
  void runChain(jobId, body, skipEndpoints, yearsArg);

  return NextResponse.json({ jobId });
}

async function runChain(
  jobId: string,
  config: ScrapeRequest,
  skipEndpoints: string[],
  yearsArg: string,
): Promise<void> {
  const log = logFile(jobId);

  try {
    for (const p of config.periods) {
      const spider =
        p === "annual" ? "stockbit_spider" : "stockbit_quarterly_spider";
      const jsonOut = outputFileForPeriod(jobId, p);

      const args = [
        "crawl",
        spider,
        "-O",
        jsonOut,
        "-a",
        `symbol_file=${symbolFile(jobId)}`,
        "-a",
        `years=${yearsArg}`,
      ];
      if (skipEndpoints.length) {
        args.push("-a", `skip_endpoints=${skipEndpoints.join(",")}`);
      }

      fs.appendFileSync(log, `\n[SCRAPEBIT] Phase: ${p}\n`);
      await runOnce(SCRAPY_BIN, args, log);

      // Convert ke Excel / CSV kalau user pilih non-json
      if (config.format !== "json") {
        fs.appendFileSync(log, `[SCRAPEBIT] Converting ${p} → ${config.format}\n`);
        await convertOutput(jsonOut, config.format, log);
      }
    }
    finalize(jobId, config, null);
  } catch (err) {
    fs.appendFileSync(log, `\n[SCRAPEBIT] FAILED: ${err}\n`);
    finalize(jobId, config, String(err));
  }
}

async function convertOutput(
  jsonPath: string,
  format: OutputFormat,
  logPath: string,
): Promise<void> {
  const ext = format === "excel" ? "xlsx" : "csv";
  const outputPath = jsonPath.replace(/\.json$/, `.${ext}`);
  const converterScript = path.join(SCRAPER_DIR, "scrapebit_convert.py");

  await runOnce(
    PYTHON_BIN,
    [
      converterScript,
      "--input",
      jsonPath,
      "--output",
      outputPath,
      "--format",
      format,
    ],
    logPath,
  );
}

function runOnce(bin: string, args: string[], logPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = fs.openSync(logPath, "a");
    const child = spawn(bin, args, {
      cwd: SCRAPER_DIR,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      stdio: ["ignore", stream, stream],
      // Important: NO shell, NO cmd /c. Direct spawn, args as array.
      // Windows handles path with spaces correctly when args is array.
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

function finalize(
  jobId: string,
  config: ScrapeRequest,
  error: string | null,
): void {
  try {
    const stateFile = path.join(jobDir(jobId), "state.json");
    const cur = JSON.parse(fs.readFileSync(stateFile, "utf-8")) as JobStatus;
    cur.state = error ? "failed" : "done";
    cur.endedAt = Date.now();
    cur.error = error;
    cur.outputs = [];
    const ext =
      config.format === "json"
        ? "json"
        : config.format === "excel"
          ? "xlsx"
          : "csv";
    for (const p of config.periods) {
      const fp = outputFileForPeriod(jobId, p, ext);
      if (fs.existsSync(fp)) {
        cur.outputs.push({
          period: p,
          filename: path.basename(fp),
          sizeBytes: fs.statSync(fp).size,
        });
      }
    }
    fs.writeFileSync(stateFile, JSON.stringify(cur, null, 2));
  } catch {
    // ignore
  }
}

function computeSkipped(selected: string[]): string[] {
  const optional = [
    "dividend",
    "emitten_info",
    "price_performance",
    "keystats",
  ];
  return optional.filter((f) => !selected.includes(f));
}

void ({} as PeriodType);
