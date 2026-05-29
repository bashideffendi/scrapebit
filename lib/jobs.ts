/**
 * Simple file-backed job tracker. State per job di {JOBS_DIR}/{jobId}/state.json.
 * Cocok buat local-only — no DB needed.
 */

import "server-only";
import fs from "node:fs";
import path from "node:path";
import { JOBS_DIR, type JobStatus } from "./config";

export function jobDir(jobId: string): string {
  return path.join(JOBS_DIR, jobId);
}

export function stateFile(jobId: string): string {
  return path.join(jobDir(jobId), "state.json");
}

export function logFile(jobId: string): string {
  return path.join(jobDir(jobId), "scrape.log");
}

export function symbolFile(jobId: string): string {
  return path.join(jobDir(jobId), "symbols.json");
}

export function outputFile(jobId: string, ext: string): string {
  return path.join(jobDir(jobId), `output.${ext}`);
}

export function outputFileForPeriod(
  jobId: string,
  period: "annual" | "quarterly",
  ext: string = "json",
): string {
  return path.join(jobDir(jobId), `output_${period}.${ext}`);
}

export function ensureJobsDir(): void {
  if (!fs.existsSync(JOBS_DIR)) fs.mkdirSync(JOBS_DIR, { recursive: true });
}

export function writeState(jobId: string, state: JobStatus): void {
  ensureJobsDir();
  if (!fs.existsSync(jobDir(jobId))) fs.mkdirSync(jobDir(jobId), { recursive: true });
  fs.writeFileSync(stateFile(jobId), JSON.stringify(state, null, 2), "utf-8");
}

export function readState(jobId: string): JobStatus | null {
  try {
    return JSON.parse(fs.readFileSync(stateFile(jobId), "utf-8")) as JobStatus;
  } catch {
    return null;
  }
}

export function listJobs(): JobStatus[] {
  ensureJobsDir();
  const entries = fs.readdirSync(JOBS_DIR, { withFileTypes: true });
  const jobs: JobStatus[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const s = readState(e.name);
    if (s) jobs.push(s);
  }
  return jobs.sort((a, b) => b.startedAt - a.startedAt);
}

export function newJobId(): string {
  const ts = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14); // YYYYMMDDHHmmss
  const rand = Math.random().toString(36).slice(2, 6);
  return `${ts}-${rand}`;
}

/** Parse scrapy log buat hitung progress. Format: "[CRAWL] [N/M] TICKER ..."
 * Multi-phase support: detect "Mulai scraping ... (Annual)" / "(Quarterly)" sebagai
 * marker phase. Combined progress = sum of completed phases + current phase fraction.
 */
export function parseProgress(
  log: string,
  expectedPhases: ("annual" | "quarterly")[] = ["annual"],
): {
  current: number;
  total: number;
  phase: "annual" | "quarterly" | null;
} {
  const lines = log.split("\n");
  let phase: "annual" | "quarterly" | null = null;
  let phaseTotal = 0;
  let phaseCurrent = 0;
  let phasesCompleted = 0;
  let lastTotalPerPhase = 0;

  for (const line of lines) {
    if (line.includes("(Annual)") && line.includes("Mulai scraping")) {
      // Starting annual phase
      if (phase === "quarterly") phasesCompleted++;
      phase = "annual";
      phaseCurrent = 0;
    } else if (line.includes("(Quarterly)") && line.includes("Mulai scraping")) {
      if (phase === "annual") phasesCompleted++;
      phase = "quarterly";
      phaseCurrent = 0;
    }
    const m = line.match(/\[CRAWL\] \[(\d+)\/(\d+)\]/);
    if (m) {
      phaseCurrent = parseInt(m[1]);
      phaseTotal = parseInt(m[2]);
      lastTotalPerPhase = phaseTotal;
    }
  }

  const numPhases = Math.max(expectedPhases.length, 1);
  const combinedTotal = lastTotalPerPhase * numPhases || phaseTotal;
  const combinedCurrent = phasesCompleted * lastTotalPerPhase + phaseCurrent;
  return { current: combinedCurrent, total: combinedTotal, phase };
}

export function tailLog(jobId: string, n: number = 20): string[] {
  try {
    const txt = fs.readFileSync(logFile(jobId), "utf-8");
    const lines = txt.split("\n").filter((l) => l.trim());
    return lines.slice(-n);
  } catch {
    return [];
  }
}
