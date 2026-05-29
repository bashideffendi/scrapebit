"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  JobStatus,
  OutputFormat,
  PeriodType,
  ScrapeFieldId,
  Ticker,
} from "@/lib/config";
import {
  OUTPUT_FORMATS,
  PERIOD_TYPES,
  SCRAPE_FIELDS,
} from "@/lib/config";

const CURRENT_YEAR = new Date().getFullYear();

type AuthState =
  | { valid: true; remainingSec: number; expiresAtIso: string }
  | { valid: false; reason: string }
  | { valid: null };

export function ScraperShell({ initialTickers }: { initialTickers: Ticker[] }) {
  const [tickers, setTickers] = useState<Ticker[]>(initialTickers);
  const [tickersLastModified, setTickersLastModified] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [periods, setPeriods] = useState<Set<PeriodType>>(
    new Set<PeriodType>(["annual", "quarterly"]),
  );
  const [yearFrom, setYearFrom] = useState(CURRENT_YEAR - 5);
  const [yearTo, setYearTo] = useState(CURRENT_YEAR);
  const [fields, setFields] = useState<Set<ScrapeFieldId>>(
    new Set<ScrapeFieldId>([
      "income_statement",
      "balance_sheet",
      "cash_flow",
    ]),
  );
  const [format, setFormat] = useState<OutputFormat>("json");
  const [activeJob, setActiveJob] = useState<JobStatus | null>(null);
  const [refreshJob, setRefreshJob] = useState<JobStatus | null>(null);
  const [auth, setAuth] = useState<AuthState>({ valid: null });
  const [loginOpen, setLoginOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Auth check on mount + every 60s ─────────────────────────────────────
  const checkAuth = useCallback(async () => {
    try {
      const r = await fetch("/api/auth/status");
      setAuth((await r.json()) as AuthState);
    } catch {
      setAuth({ valid: false, reason: "network" });
    }
  }, []);

  useEffect(() => {
    void checkAuth();
    const t = setInterval(checkAuth, 60_000);
    return () => clearInterval(t);
  }, [checkAuth]);

  // ── Fetch tickers from API (overrides initial static) ───────────────────
  const reloadTickers = useCallback(async () => {
    try {
      const r = await fetch("/api/tickers");
      if (r.ok) {
        const data = (await r.json()) as {
          tickers: Ticker[];
          lastModifiedIso: string;
        };
        setTickers(data.tickers);
        setTickersLastModified(data.lastModifiedIso);
      }
    } catch {
      // keep initial
    }
  }, []);

  useEffect(() => {
    void reloadTickers();
  }, [reloadTickers]);

  // ── Poll active job ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeJob || activeJob.state === "done" || activeJob.state === "failed")
      return;
    const id = setInterval(async () => {
      const r = await fetch(`/api/scrape/${activeJob.jobId}/status`);
      if (r.ok) setActiveJob((await r.json()) as JobStatus);
    }, 2000);
    return () => clearInterval(id);
  }, [activeJob]);

  // ── Poll refresh job ─────────────────────────────────────────────────────
  useEffect(() => {
    if (
      !refreshJob ||
      refreshJob.state === "done" ||
      refreshJob.state === "failed"
    )
      return;
    const id = setInterval(async () => {
      const r = await fetch(`/api/scrape/${refreshJob.jobId}/status`);
      if (r.ok) {
        const s = (await r.json()) as JobStatus;
        setRefreshJob(s);
        if (s.state === "done") void reloadTickers();
      }
    }, 2000);
    return () => clearInterval(id);
  }, [refreshJob, reloadTickers]);

  // ── Filter tickers ──────────────────────────────────────────────────────
  // matchedAll: SEMUA ticker yg match search (buat "select all matching")
  // filtered: max 100 baris buat render (perf)
  const matchedAll = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return tickers;
    return tickers.filter(
      (t) =>
        t.ticker.toLowerCase().includes(q) ||
        (t.name ?? "").toLowerCase().includes(q) ||
        t.sectors.some((s) => s.toLowerCase().includes(q)),
    );
  }, [tickers, search]);

  const filtered = useMemo(() => {
    return search.trim() ? matchedAll.slice(0, 100) : tickers.slice(0, 50);
  }, [matchedAll, search, tickers]);

  // Sector quick-filter chips (top sectors from full list)
  const topSectors = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tickers) {
      for (const s of t.sectors) {
        // Skip indeks/listing-board buckets (noise)
        if (
          s === "Indeks" ||
          s === "Indeks Sektoral" ||
          s === "Listing Board" ||
          s === "Delisted Stock"
        )
          continue;
        counts.set(s, (counts.get(s) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 11);
  }, [tickers]);

  function toggleTicker(t: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  function selectAllMatching() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const t of matchedAll) next.add(t.ticker);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function invertSelection() {
    setSelected((prev) => {
      const next = new Set<string>();
      for (const t of matchedAll) if (!prev.has(t.ticker)) next.add(t.ticker);
      return next;
    });
  }

  function toggleField(f: ScrapeFieldId) {
    setFields((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  }

  function selectAllFields() {
    setFields(new Set(SCRAPE_FIELDS.map((f) => f.id)));
  }

  function clearFields() {
    setFields(new Set(SCRAPE_FIELDS.filter((f) => f.required).map((f) => f.id)));
  }

  function togglePeriod(p: PeriodType) {
    setPeriods((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  async function startScrape() {
    setError(null);
    if (selected.size === 0) return setError("Pilih minimal 1 ticker");
    if (periods.size === 0) return setError("Pilih minimal 1 periode");
    setPosting(true);
    try {
      const r = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tickers: Array.from(selected),
          periods: Array.from(periods),
          yearFrom,
          yearTo,
          fields: Array.from(fields),
          format,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Failed");
      const { jobId } = (await r.json()) as { jobId: string };
      const s = await fetch(`/api/scrape/${jobId}/status`).then((x) => x.json());
      setActiveJob(s);
    } catch (err) {
      setError(String(err));
    } finally {
      setPosting(false);
    }
  }

  async function startRefresh() {
    const r = await fetch("/api/refresh-tickers", { method: "POST" });
    if (r.ok) {
      const { jobId } = (await r.json()) as { jobId: string };
      const s = await fetch(`/api/scrape/${jobId}/status`).then((x) => x.json());
      setRefreshJob(s);
    }
  }

  const sortedSelected = useMemo(() => Array.from(selected).sort(), [selected]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <TopBar
        auth={auth}
        onLogin={() => setLoginOpen(true)}
        tickerCount={tickers.length}
        tickersLastModified={tickersLastModified}
        onRefreshTickers={startRefresh}
        refreshJob={refreshJob}
      />

      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
          {/* ── Config column ────────────────────────────────── */}
          <div className="space-y-4">
            <Panel title="01" subtitle="Pilih Ticker" right={`${selected.size} dipilih`}>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari ticker / nama / sektor…"
                className="mb-2 w-full rounded border border-zinc-800 bg-zinc-950 px-3 py-1.5 font-mono text-xs uppercase tracking-wider outline-none placeholder:text-zinc-600 focus:border-emerald-600"
              />

              {/* Sector quick chips */}
              <div className="mb-2 flex flex-wrap gap-1">
                <button
                  onClick={() => setSearch("")}
                  className={`rounded border px-1.5 py-0.5 text-[10px] ${
                    !search
                      ? "border-emerald-700 bg-emerald-950 text-emerald-300"
                      : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700"
                  }`}
                >
                  all
                </button>
                {topSectors.map(([s, n]) => (
                  <button
                    key={s}
                    onClick={() => setSearch(s)}
                    className={`rounded border px-1.5 py-0.5 text-[10px] ${
                      search === s
                        ? "border-emerald-700 bg-emerald-950 text-emerald-300"
                        : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700"
                    }`}
                    title={`${n} ticker`}
                  >
                    {s} <span className="text-zinc-600">{n}</span>
                  </button>
                ))}
              </div>

              {/* Bulk action bar */}
              <div className="mb-2 flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/50 px-2 py-1">
                <span className="font-mono text-[10px] text-zinc-500">
                  match: {matchedAll.length}
                </span>
                <button
                  onClick={selectAllMatching}
                  disabled={matchedAll.length === 0}
                  className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] hover:border-emerald-700 hover:text-emerald-300 disabled:opacity-50"
                >
                  ✓ select all matching
                </button>
                <button
                  onClick={invertSelection}
                  disabled={matchedAll.length === 0}
                  className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] hover:border-amber-700 hover:text-amber-300 disabled:opacity-50"
                  title="Invert selection di matching"
                >
                  ⇄ invert
                </button>
                <button
                  onClick={clearSelection}
                  disabled={selected.size === 0}
                  className="ml-auto rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] hover:border-rose-700 hover:text-rose-300 disabled:opacity-50"
                >
                  ✕ clear ({selected.size})
                </button>
              </div>

              <div className="max-h-72 overflow-y-auto rounded border border-zinc-800 bg-zinc-950/50">
                {filtered.length === 0 ? (
                  <div className="p-3 text-xs text-zinc-500">Tidak ada match.</div>
                ) : (
                  filtered.map((t) => (
                    <label
                      key={t.ticker}
                      className="flex cursor-pointer items-center gap-3 border-b border-zinc-900 px-3 py-1.5 text-xs last:border-b-0 hover:bg-zinc-900"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(t.ticker)}
                        onChange={() => toggleTicker(t.ticker)}
                        className="accent-emerald-500"
                      />
                      <span className="w-16 font-mono font-bold text-emerald-400">
                        {t.ticker}
                      </span>
                      <span className="flex-1 truncate text-zinc-400">
                        {t.name}
                      </span>
                    </label>
                  ))
                )}
              </div>
              {selected.size > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {sortedSelected.map((t) => (
                    <button
                      key={t}
                      onClick={() => toggleTicker(t)}
                      className="rounded border border-emerald-900 bg-emerald-950 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300 hover:border-rose-700 hover:bg-rose-950 hover:text-rose-300"
                      title="Klik buat hapus"
                    >
                      {t} ×
                    </button>
                  ))}
                </div>
              )}
            </Panel>

            <div className="grid gap-4 md:grid-cols-2">
              <Panel title="02" subtitle="Periode" right={`${periods.size} dipilih`}>
                <div className="flex flex-col gap-1.5">
                  {PERIOD_TYPES.map((p) => (
                    <label
                      key={p.id}
                      className="flex cursor-pointer items-center gap-2 rounded border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs hover:border-zinc-700"
                    >
                      <input
                        type="checkbox"
                        checked={periods.has(p.id)}
                        onChange={() => togglePeriod(p.id)}
                        className="accent-emerald-500"
                      />
                      {p.label}
                    </label>
                  ))}
                </div>
                {periods.size === 2 && (
                  <p className="mt-1.5 font-mono text-[10px] text-zinc-500">
                    // 2 spider chain: annual → quarterly (sequential, ~2x waktu)
                  </p>
                )}
              </Panel>

              <Panel
                title="03"
                subtitle="Range Tahun"
                right={`${yearFrom}–${yearTo} (${yearTo - yearFrom + 1}thn)`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={2010}
                    max={CURRENT_YEAR}
                    value={yearFrom}
                    onChange={(e) => setYearFrom(Number(e.target.value))}
                    className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-xs outline-none focus:border-emerald-600"
                  />
                  <span className="text-zinc-600">→</span>
                  <input
                    type="number"
                    min={2010}
                    max={CURRENT_YEAR}
                    value={yearTo}
                    onChange={(e) => setYearTo(Number(e.target.value))}
                    className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-xs outline-none focus:border-emerald-600"
                  />
                </div>
              </Panel>
            </div>

            <Panel
              title="04"
              subtitle="Data yang Di-scrape"
              right={`${fields.size}/${SCRAPE_FIELDS.length}`}
            >
              <div className="mb-2 flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/50 px-2 py-1">
                <button
                  onClick={selectAllFields}
                  className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] hover:border-emerald-700 hover:text-emerald-300"
                >
                  ✓ select all
                </button>
                <button
                  onClick={clearFields}
                  className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] hover:border-rose-700 hover:text-rose-300"
                >
                  ✕ clear optional
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {SCRAPE_FIELDS.map((f) => (
                  <label
                    key={f.id}
                    className={`flex cursor-pointer items-center gap-2 rounded border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs hover:border-zinc-700 ${
                      f.required ? "opacity-60" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={fields.has(f.id) || f.required}
                      disabled={f.required}
                      onChange={() => toggleField(f.id)}
                      className="accent-emerald-500"
                    />
                    {f.label}
                    {f.required && (
                      <span className="ml-auto text-[9px] text-zinc-600">
                        wajib
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </Panel>

            <Panel title="05" subtitle="Format Output">
              <div className="flex gap-1.5">
                {OUTPUT_FORMATS.map((f) => (
                  <label
                    key={f.id}
                    className="flex flex-1 cursor-pointer items-center gap-2 rounded border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs hover:border-zinc-700"
                  >
                    <input
                      type="radio"
                      name="format"
                      checked={format === f.id}
                      onChange={() => setFormat(f.id)}
                      className="accent-emerald-500"
                    />
                    {f.label}
                  </label>
                ))}
              </div>
            </Panel>

            <div className="flex items-center gap-3">
              <button
                onClick={startScrape}
                disabled={posting || selected.size === 0 || auth.valid === false}
                className="rounded border border-emerald-700 bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-[0_0_20px_-5px_rgba(16,185,129,0.5)] hover:bg-emerald-500 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-900 disabled:text-zinc-600 disabled:shadow-none"
              >
                {posting
                  ? "Starting…"
                  : `> Start Scrape (${selected.size} ticker)`}
              </button>
              {auth.valid === false && (
                <span className="text-xs text-amber-400">
                  Login dulu di kanan atas
                </span>
              )}
              {error && <span className="text-xs text-rose-400">{error}</span>}
            </div>
          </div>

          {/* ── Job panel ────────────────────────────────────── */}
          <aside className="lg:sticky lg:top-4 lg:self-start">
            {activeJob ? <JobPanel job={activeJob} /> : <EmptyJobPanel />}
          </aside>
        </div>
      </main>

      {loginOpen && (
        <LoginModal
          onClose={() => setLoginOpen(false)}
          onSuccess={() => {
            setLoginOpen(false);
            void checkAuth();
          }}
        />
      )}
    </div>
  );
}

// ─── TopBar ─────────────────────────────────────────────────────────────────

function TopBar({
  auth,
  onLogin,
  tickerCount,
  tickersLastModified,
  onRefreshTickers,
  refreshJob,
}: {
  auth: AuthState;
  onLogin: () => void;
  tickerCount: number;
  tickersLastModified: string | null;
  onRefreshTickers: () => void;
  refreshJob: JobStatus | null;
}) {
  const refreshing =
    refreshJob?.state === "running" || refreshJob?.state === "queued";
  return (
    <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold tracking-tight">
            <span className="text-emerald-400">$</span> Scrapebit
          </span>
          <span className="hidden text-xs text-zinc-500 md:inline">
            stockbit scraper UI · local-only
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <TickerStatus
            count={tickerCount}
            lastModified={tickersLastModified}
            refreshing={refreshing}
            onRefresh={onRefreshTickers}
          />
          <AuthBadge auth={auth} onLogin={onLogin} />
        </div>
      </div>
      {refreshJob && refreshJob.state === "running" && (
        <div className="border-t border-zinc-800 bg-amber-950/30 px-4 py-1 text-xs text-amber-200">
          [REFRESH] Crawling symbol list… ini ~3-5 menit. List ticker auto-reload pas selesai.
        </div>
      )}
    </header>
  );
}

function TickerStatus({
  count,
  lastModified,
  refreshing,
  onRefresh,
}: {
  count: number;
  lastModified: string | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const age = lastModified ? daysAgo(lastModified) : null;
  const stale = age !== null && age > 7;
  return (
    <div className="flex items-center gap-1.5">
      <div className="hidden text-right text-[10px] leading-tight md:block">
        <div className="font-mono">{count} ticker</div>
        <div className={stale ? "text-amber-400" : "text-zinc-500"}>
          {age === null ? "?" : age === 0 ? "today" : `${age}d ago`}
        </div>
      </div>
      <button
        onClick={onRefresh}
        disabled={refreshing}
        className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[10px] hover:border-zinc-700 disabled:opacity-50"
        title={lastModified ? `Last refresh ${lastModified}` : "Refresh list"}
      >
        {refreshing ? "⟳ refreshing…" : "⟳ refresh tickers"}
      </button>
    </div>
  );
}

function AuthBadge({
  auth,
  onLogin,
}: {
  auth: AuthState;
  onLogin: () => void;
}) {
  if (auth.valid === null) {
    return (
      <span className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-500">
        ● checking…
      </span>
    );
  }
  if (auth.valid) {
    const hours = Math.floor(auth.remainingSec / 3600);
    return (
      <button
        onClick={onLogin}
        className="rounded border border-emerald-900 bg-emerald-950 px-2 py-1 text-[10px] text-emerald-300 hover:border-emerald-700"
        title={`Token expires at ${auth.expiresAtIso}`}
      >
        ● token aktif · {hours}h sisa
      </button>
    );
  }
  return (
    <button
      onClick={onLogin}
      className="rounded border border-amber-900 bg-amber-950 px-2 py-1 text-[10px] text-amber-300 hover:border-amber-700"
    >
      ● {auth.reason} · login
    </button>
  );
}

// ─── Panels ────────────────────────────────────────────────────────────────

function Panel({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle: string;
  right?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-zinc-800 bg-zinc-900/40">
      <header className="flex items-baseline justify-between border-b border-zinc-800 px-3 py-1.5">
        <h2 className="text-xs">
          <span className="font-mono text-zinc-500">{title}</span>{" "}
          <span className="font-semibold uppercase tracking-wider">
            {subtitle}
          </span>
        </h2>
        {right && (
          <span className="font-mono text-[10px] text-zinc-500">{right}</span>
        )}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

function EmptyJobPanel() {
  return (
    <div className="rounded-md border border-dashed border-zinc-800 bg-zinc-900/20 p-6 text-center font-mono text-xs text-zinc-600">
      // belum ada scrape jalan
      <br />
      pilih ticker + config, klik Start.
    </div>
  );
}

function JobPanel({ job }: { job: JobStatus }) {
  const pct = job.progress.total
    ? Math.round((job.progress.current / job.progress.total) * 100)
    : 0;
  const isActive = job.state === "running";

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/40">
      <header className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
        <span className="font-mono text-[10px] text-zinc-500">{job.jobId}</span>
        <StateBadge state={job.state} />
      </header>

      <div className="p-3">
        {job.currentPhase && isActive && (
          <div className="mb-1.5 font-mono text-[10px] text-zinc-500">
            phase: <span className="text-sky-300">{job.currentPhase}</span>
          </div>
        )}
        <div className="mb-1.5 flex justify-between font-mono text-xs">
          <span>
            {job.progress.current} / {job.progress.total} ticker
          </span>
          <span>{pct}%</span>
        </div>
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            className={`h-full transition-all ${
              job.state === "failed"
                ? "bg-rose-500"
                : job.state === "done"
                  ? "bg-emerald-500"
                  : "bg-sky-500"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>

        {job.state === "done" && job.outputs.length > 0 && (
          <div className="mb-3 flex flex-col gap-1.5">
            {job.outputs.map((o) => (
              <a
                key={o.filename}
                href={`/api/scrape/${job.jobId}/download?file=${encodeURIComponent(o.filename)}`}
                className="flex items-center justify-between rounded border border-emerald-700 bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                download
              >
                <span>↓ {o.period.toUpperCase()}</span>
                <span className="font-mono text-[10px] opacity-80">
                  {formatBytes(o.sizeBytes)}
                </span>
              </a>
            ))}
          </div>
        )}

        {job.error && (
          <div className="mb-3 rounded border border-rose-900 bg-rose-950 p-2 text-xs text-rose-300">
            {job.error}
          </div>
        )}

        <details open={isActive}>
          <summary className="cursor-pointer text-[10px] text-zinc-500">
            // log (tail {job.logTail.length})
          </summary>
          <pre className="mt-2 max-h-72 overflow-y-auto rounded bg-black p-2 font-mono text-[10px] leading-snug text-emerald-300">
            {job.logTail.join("\n") || "(empty)"}
          </pre>
        </details>
      </div>
    </div>
  );
}

function StateBadge({ state }: { state: JobStatus["state"] }) {
  const colors = {
    queued: "border-zinc-800 bg-zinc-900 text-zinc-400",
    running: "border-sky-900 bg-sky-950 text-sky-300 animate-pulse",
    done: "border-emerald-900 bg-emerald-950 text-emerald-300",
    failed: "border-rose-900 bg-rose-950 text-rose-300",
  };
  return (
    <span
      className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${colors[state]}`}
    >
      {state}
    </span>
  );
}

// ─── Login Modal ───────────────────────────────────────────────────────────

type LoginPhase =
  | "credentials"
  | "choose_channel"
  | "enter_otp"
  | "next_factor";

interface LoginCtx {
  phase: LoginPhase;
  availableChannels: string[];
  completedChannels: string[];
  currentChannel: string | null;
  preview: Record<string, unknown> | null;
}

const CHANNEL_LABELS: Record<string, string> = {
  CHANNEL_EMAIL: "Email",
  CHANNEL_WHATSAPP: "WhatsApp",
  CHANNEL_SMS: "SMS",
  CHANNEL_AUTHENTICATOR: "Authenticator app",
};

function LoginModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [ctx, setCtx] = useState<LoginCtx>({
    phase: "credentials",
    availableChannels: [],
    completedChannels: [],
    currentChannel: null,
    preview: null,
  });
  const [posting, setPosting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function post(body: Record<string, unknown>) {
    setErr(null);
    setPosting(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await r.json()) as Record<string, unknown>;
      if (!r.ok) throw new Error(String(data.error || "Failed"));
      handleResponse(data);
    } catch (e) {
      setErr(String(e));
    } finally {
      setPosting(false);
    }
  }

  function handleResponse(data: Record<string, unknown>) {
    const mode = data.mode as string;
    switch (mode) {
      case "direct":
      case "otp_verified":
        onSuccess();
        return;
      case "awaiting_channel":
        setCtx((prev) => ({
          ...prev,
          phase: "choose_channel",
          availableChannels: (data.channels as string[]) || [],
          preview: (data.preview as Record<string, unknown>) || null,
        }));
        return;
      case "otp_sent":
        setCtx((prev) => ({
          ...prev,
          phase: "enter_otp",
          currentChannel: (data.channel as string) || null,
          preview: (data.preview as Record<string, unknown>) || null,
        }));
        return;
      case "awaiting_next_factor":
        setCtx((prev) => ({
          ...prev,
          phase: "next_factor",
          availableChannels: (data.channelsRemaining as string[]) || [],
          completedChannels: (data.channelsCompleted as string[]) || prev.completedChannels,
          currentChannel: null,
        }));
        setOtp("");
        return;
      default:
        setErr(`Unknown mode: ${mode}`);
    }
  }

  function submitCredentials() {
    void post({ email, password });
  }
  function requestChannel(channel: string) {
    void post({ requestOtp: channel });
  }
  function submitOtp() {
    void post({ otp });
  }

  const previewStr = (() => {
    if (!ctx.preview) return null;
    const p = ctx.preview as Record<string, string>;
    return p.email || p.whatsapp || p.phone || p.target || null;
  })();

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/70 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-md border border-zinc-800 bg-zinc-950 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-mono text-sm uppercase tracking-wider">
            $ stockbit.{ctx.phase}
          </h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            ✕
          </button>
        </div>

        {/* Phase progress dot */}
        {ctx.phase !== "credentials" && (
          <div className="mb-3 flex items-center gap-1.5 text-[10px] text-zinc-500">
            <span className="text-emerald-400">✓ login</span>
            {ctx.completedChannels.map((c) => (
              <span key={c} className="text-emerald-400">
                ✓ {CHANNEL_LABELS[c] ?? c}
              </span>
            ))}
            <span className="text-amber-400">● next</span>
          </div>
        )}

        {ctx.phase === "credentials" && (
          <div className="space-y-3">
            <FormRow label="email">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                className="w-full rounded border border-zinc-800 bg-zinc-950 px-3 py-1.5 font-mono text-xs outline-none focus:border-emerald-600"
                placeholder="bashide@gmail.com"
              />
            </FormRow>
            <FormRow label="password">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded border border-zinc-800 bg-zinc-950 px-3 py-1.5 font-mono text-xs outline-none focus:border-emerald-600"
              />
            </FormRow>
            <button
              onClick={submitCredentials}
              disabled={posting || !email || !password}
              className="w-full rounded border border-emerald-700 bg-emerald-600 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-900 disabled:text-zinc-600"
            >
              {posting ? "logging in…" : "> login"}
            </button>
            <p className="text-[10px] text-zinc-500">
              Credential cuma dipake spawn login_token.py local. Token disimpen
              di .token.json di scraper folder.
            </p>
          </div>
        )}

        {(ctx.phase === "choose_channel" || ctx.phase === "next_factor") && (
          <div className="space-y-3">
            <p className="rounded border border-amber-900 bg-amber-950 p-2 text-xs text-amber-300">
              {ctx.phase === "next_factor"
                ? "Stockbit minta verifikasi tambahan. Pilih channel berikutnya:"
                : "Stockbit detect new device. Pilih channel buat kirim OTP:"}
            </p>
            <div className="flex flex-col gap-1.5">
              {ctx.availableChannels.length === 0 ? (
                <p className="text-xs text-zinc-500">
                  Channel list kosong dari Stockbit. Coba manual:
                </p>
              ) : null}
              {(ctx.availableChannels.length
                ? ctx.availableChannels
                : ["CHANNEL_EMAIL", "CHANNEL_WHATSAPP", "CHANNEL_SMS"]
              ).map((c) => (
                <button
                  key={c}
                  onClick={() => requestChannel(c)}
                  disabled={posting}
                  className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs hover:border-emerald-700 hover:text-emerald-300 disabled:opacity-50"
                >
                  <span>{CHANNEL_LABELS[c] ?? c}</span>
                  <span className="font-mono text-[10px] text-zinc-500">
                    {c}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {ctx.phase === "enter_otp" && (
          <div className="space-y-3">
            <p className="rounded border border-amber-900 bg-amber-950 p-2 text-xs text-amber-300">
              OTP dikirim via{" "}
              <strong>
                {CHANNEL_LABELS[ctx.currentChannel ?? ""] ?? ctx.currentChannel}
              </strong>
              {previewStr ? ` ke ${previewStr}` : ""}.
            </p>
            <FormRow label="otp">
              <input
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                autoFocus
                inputMode="numeric"
                maxLength={6}
                className="w-full rounded border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-center font-mono text-base tracking-[0.5em] outline-none focus:border-emerald-600"
              />
            </FormRow>
            <button
              onClick={submitOtp}
              disabled={posting || otp.length !== 6}
              className="w-full rounded border border-emerald-700 bg-emerald-600 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-900 disabled:text-zinc-600"
            >
              {posting ? "verifying…" : "> verify"}
            </button>
            <button
              onClick={() =>
                setCtx((prev) => ({
                  ...prev,
                  phase: "choose_channel",
                  currentChannel: null,
                }))
              }
              className="w-full text-[10px] text-zinc-500 hover:text-zinc-300"
            >
              ← ganti channel
            </button>
          </div>
        )}

        {err && (
          <div className="mt-3 rounded border border-rose-900 bg-rose-950 p-2 text-xs text-rose-300">
            {err}
          </div>
        )}
      </div>
    </div>
  );
}

function FormRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      {children}
    </label>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function daysAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 3600 * 1000));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
