import "server-only";
import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { readState, jobDir } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/scrape/[jobId]/download?file=output_annual.json
 * Serve specific output file dari job folder.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const state = readState(jobId);
  if (!state) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (state.state !== "done") {
    return NextResponse.json({ error: "Job not finished" }, { status: 400 });
  }

  const url = new URL(req.url);
  const requested = url.searchParams.get("file");
  if (!requested) {
    return NextResponse.json(
      { error: "Missing ?file= query param" },
      { status: 400 },
    );
  }

  // Sanitize — only files known in state.outputs
  const allowed = state.outputs.map((o) => o.filename);
  if (!allowed.includes(requested)) {
    return NextResponse.json(
      { error: "File not in this job's outputs" },
      { status: 403 },
    );
  }

  const filePath = path.join(jobDir(jobId), requested);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json(
      { error: "Output file missing" },
      { status: 404 },
    );
  }

  const buf = fs.readFileSync(filePath);
  const ext = path.extname(requested).slice(1) || "json";
  const contentType =
    ext === "json"
      ? "application/json"
      : ext === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "text/csv";
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="scrapebit-${jobId}-${requested}"`,
    },
  });
}
