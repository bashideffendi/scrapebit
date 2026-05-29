import "server-only";
import { NextResponse } from "next/server";
import { readState, parseProgress, tailLog, logFile } from "@/lib/jobs";
import fs from "node:fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/scrape/[jobId]/status
 * Returns merged state.json + parsed progress + log tail.
 */
export async function GET(
  _: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const state = readState(jobId);
  if (!state) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  let logContent = "";
  try {
    logContent = fs.readFileSync(logFile(jobId), "utf-8");
  } catch {
    // log not yet
  }
  const expectedPhases = state.config.periods ?? ["annual"];
  const live = parseProgress(logContent, expectedPhases);
  if (live.total > 0) {
    state.progress = { current: live.current, total: live.total };
  }
  state.currentPhase = live.phase;
  state.logTail = tailLog(jobId, 30);

  return NextResponse.json(state);
}
