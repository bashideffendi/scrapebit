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
  const [tickersLastModified, setTickersLastModified] = useState<string | null>(
    null,
  );
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

  // ── Fetch tickers from API ──────────────────────────────────────────────
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

  // ── Polling ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeJob || activeJob.state === "done" || activeJob.state === "failed")
      return;
    const id = setInterval(async () => {
      const r = await fetch(`/api/scrape/${activeJob.jobId}/status`);
      if (r.ok) setActiveJob((await r.json()) as JobStatus);
    }, 2000);
    return () => clearInterval(id);
  }, [activeJob]);

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

  // ── Filtered tickers ────────────────────────────────────────────────────
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

  const filtered = useMemo(
    () => (search.trim() ? matchedAll.slice(0, 100) : tickers.slice(0, 50)),
    [matchedAll, search, tickers],
  );

  const topSectors = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tickers) {
      for (const s of t.sectors) {
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
  function toggleField(f: ScrapeFieldId) {
    setFields((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  }
  function togglePeriod(p: PeriodType) {
    setPeriods((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
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
  function selectAllFields() {
    setFields(new Set(SCRAPE_FIELDS.map((f) => f.id)));
  }
  function clearFields() {
    setFields(new Set(SCRAPE_FIELDS.filter((f) => f.required).map((f) => f.id)));
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
      if (!r.ok) throw new Error((await r.json()).error || "Gagal memulai");
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

      <main className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-10">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">
            Scrapebit
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            Tools selektif untuk pengambilan data keuangan emiten IDX dari
            Stockbit. Pilih ticker, periode pelaporan, rentang tahun, dan
            format ekspor sesuai kebutuhan analisis.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
          {/* Config column */}
          <div className="space-y-6">
            <Section
              step="01"
              title="Pilih Emiten"
              subtitle="Cari berdasarkan ticker, nama perusahaan, atau sektor"
              meta={`${selected.size} dipilih`}
            >
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Contoh: BBCA, Bank Central Asia, atau Financials"
                className="mb-3 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-sm outline-none transition placeholder:text-zinc-600 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600/30"
              />

              {/* Sector chips */}
              <div className="mb-3 flex flex-wrap gap-1.5">
                <ChipButton active={!search} onClick={() => setSearch("")}>
                  Semua
                </ChipButton>
                {topSectors.map(([s, n]) => (
                  <ChipButton
                    key={s}
                    active={search === s}
                    onClick={() => setSearch(s)}
                    badge={n}
                  >
                    {s}
                  </ChipButton>
                ))}
              </div>

              {/* Bulk action bar */}
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2">
                <span className="text-xs text-zinc-400">
                  {matchedAll.length.toLocaleString("id-ID")} hasil
                </span>
                <div className="ml-auto flex flex-wrap gap-1.5">
                  <ActionButton
                    onClick={selectAllMatching}
                    disabled={matchedAll.length === 0}
                    variant="success"
                  >
                    Pilih Semua
                  </ActionButton>
                  <ActionButton
                    onClick={invertSelection}
                    disabled={matchedAll.length === 0}
                    variant="warning"
                  >
                    Balik
                  </ActionButton>
                  <ActionButton
                    onClick={clearSelection}
                    disabled={selected.size === 0}
                    variant="danger"
                  >
                    Hapus ({selected.size})
                  </ActionButton>
                </div>
              </div>

              {/* Ticker list */}
              <div className="max-h-80 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950/40">
                {filtered.length === 0 ? (
                  <div className="p-4 text-sm text-zinc-500">
                    Tidak ada ticker yang cocok dengan pencarian.
                  </div>
                ) : (
                  filtered.map((t) => (
                    <label
                      key={t.ticker}
                      className="flex cursor-pointer items-center gap-3 border-b border-zinc-900 px-3 py-2 text-sm last:border-b-0 hover:bg-zinc-900/60"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(t.ticker)}
                        onChange={() => toggleTicker(t.ticker)}
                        className="h-4 w-4 accent-emerald-500"
                      />
                      <span className="w-20 font-mono text-sm font-semibold text-emerald-400">
                        {t.ticker}
                      </span>
                      <span className="flex-1 truncate text-zinc-300">
                        {t.name}
                      </span>
                    </label>
                  ))
                )}
              </div>

              {selected.size > 0 && (
                <div className="mt-3">
                  <div className="mb-1.5 text-xs text-zinc-500">Terpilih:</div>
                  <div className="flex flex-wrap gap-1.5">
                    {sortedSelected.map((t) => (
                      <button
                        key={t}
                        onClick={() => toggleTicker(t)}
                        className="rounded border border-emerald-900/50 bg-emerald-950/40 px-2 py-0.5 font-mono text-xs text-emerald-300 transition hover:border-rose-700 hover:bg-rose-950/50 hover:text-rose-300"
                        title="Klik untuk menghapus"
                      >
                        {t}
                        <span className="ml-1 opacity-60">×</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </Section>

            <div className="grid gap-6 md:grid-cols-2">
              <Section
                step="02"
                title="Periode Pelaporan"
                subtitle="Pilih jenis laporan yang akan diambil"
                meta={`${periods.size} dipilih`}
              >
                <div className="flex flex-col gap-2">
                  {PERIOD_TYPES.map((p) => (
                    <OptionCard
                      key={p.id}
                      type="checkbox"
                      checked={periods.has(p.id)}
                      onChange={() => togglePeriod(p.id)}
                    >
                      {p.label}
                    </OptionCard>
                  ))}
                </div>
                {periods.size === 2 && (
                  <p className="mt-2 text-xs text-zinc-500">
                    Kedua periode akan dijalankan secara berurutan (annual lalu
                    quarterly).
                  </p>
                )}
              </Section>

              <Section
                step="03"
                title="Rentang Tahun"
                subtitle="Filter periode yang masuk ke output"
                meta={`${yearTo - yearFrom + 1} tahun`}
              >
                <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-zinc-500">
                      Dari tahun
                    </label>
                    <input
                      type="number"
                      min={2010}
                      max={CURRENT_YEAR}
                      value={yearFrom}
                      onChange={(e) => setYearFrom(Number(e.target.value))}
                      className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm outline-none focus:border-emerald-600"
                    />
                  </div>
                  <div className="pb-2.5 text-zinc-600">→</div>
                  <div>
                    <label className="mb-1 block text-xs text-zinc-500">
                      Sampai tahun
                    </label>
                    <input
                      type="number"
                      min={2010}
                      max={CURRENT_YEAR}
                      value={yearTo}
                      onChange={(e) => setYearTo(Number(e.target.value))}
                      className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm outline-none focus:border-emerald-600"
                    />
                  </div>
                </div>
              </Section>
            </div>

            <Section
              step="04"
              title="Komponen Laporan"
              subtitle="Pilih bagian laporan keuangan dan data tambahan"
              meta={`${fields.size}/${SCRAPE_FIELDS.length}`}
            >
              <div className="mb-3 flex flex-wrap gap-1.5">
                <ActionButton onClick={selectAllFields} variant="success">
                  Pilih Semua
                </ActionButton>
                <ActionButton onClick={clearFields} variant="danger">
                  Reset
                </ActionButton>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {SCRAPE_FIELDS.map((f) => (
                  <OptionCard
                    key={f.id}
                    type="checkbox"
                    checked={fields.has(f.id) || f.required}
                    disabled={f.required}
                    onChange={() => toggleField(f.id)}
                    badge={f.required ? "Wajib" : undefined}
                  >
                    {f.label}
                  </OptionCard>
                ))}
              </div>
            </Section>

            <Section
              step="05"
              title="Format Ekspor"
              subtitle="Format file output yang akan dihasilkan"
            >
              <div className="grid gap-2 sm:grid-cols-3">
                {OUTPUT_FORMATS.map((f) => (
                  <OptionCard
                    key={f.id}
                    type="radio"
                    name="format"
                    checked={format === f.id}
                    onChange={() => setFormat(f.id)}
                  >
                    {f.label}
                  </OptionCard>
                ))}
              </div>
            </Section>

            <div className="flex flex-wrap items-center gap-4 pt-2">
              <button
                onClick={startScrape}
                disabled={posting || selected.size === 0}
                className="rounded-md bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
              >
                {posting ? "Memulai…" : "Mulai Scrape"}
              </button>
              <div className="text-sm text-zinc-400">
                {selected.size} emiten · {periods.size} periode ·{" "}
                {yearTo - yearFrom + 1} tahun
              </div>
              {error && (
                <span className="text-sm text-rose-400">{error}</span>
              )}
            </div>
          </div>

          {/* Job panel */}
          <aside className="lg:sticky lg:top-[5rem] lg:self-start">
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
    refreshJob?.state === "queued" || refreshJob?.state === "running";

  return (
    <header className="sticky top-0 z-10 border-b border-zinc-800/80 bg-zinc-950/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3.5">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/30">
            <span className="text-base font-bold">S</span>
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">
              Scrapebit
            </div>
            <div className="text-xs text-zinc-500">Stockbit Data Toolkit</div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <TickerStatus
            count={tickerCount}
            lastModified={tickersLastModified}
            refreshing={refreshing}
            onRefresh={onRefreshTickers}
          />
          <div className="h-6 w-px bg-zinc-800" />
          <AuthBadge auth={auth} onLogin={onLogin} />
        </div>
      </div>
      {refreshJob && refreshJob.state === "running" && (
        <div className="border-t border-amber-900/40 bg-amber-950/30 px-6 py-1.5 text-xs text-amber-200">
          Sedang memperbarui daftar emiten (sekitar 3–5 menit). Daftar akan
          dimuat ulang otomatis setelah selesai.
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
    <div className="flex items-center gap-2">
      <div className="hidden text-right text-xs leading-tight md:block">
        <div className="font-medium text-zinc-300">
          {count.toLocaleString("id-ID")} emiten
        </div>
        <div className={stale ? "text-amber-400" : "text-zinc-500"}>
          Diperbarui {age === null ? "—" : age === 0 ? "hari ini" : `${age} hari lalu`}
        </div>
      </div>
      <button
        onClick={onRefresh}
        disabled={refreshing}
        className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/70 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-800 disabled:opacity-50"
        title={lastModified ? `Last refresh: ${lastModified}` : "Refresh list"}
      >
        <svg
          className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        {refreshing ? "Memperbarui…" : "Perbarui"}
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
      <span className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/70 px-3 py-1.5 text-xs text-zinc-500">
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
        Memeriksa…
      </span>
    );
  }
  if (auth.valid) {
    const hours = Math.floor(auth.remainingSec / 3600);
    const mins = Math.floor((auth.remainingSec % 3600) / 60);
    return (
      <button
        onClick={onLogin}
        className="inline-flex items-center gap-1.5 rounded-md border border-emerald-900/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition hover:border-emerald-700"
        title={`Token expires at ${auth.expiresAtIso}`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        Token aktif · {hours > 0 ? `${hours}j ${mins}m` : `${mins}m`}
      </button>
    );
  }
  return (
    <button
      onClick={onLogin}
      className="inline-flex items-center gap-1.5 rounded-md border border-amber-900/50 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 transition hover:border-amber-700"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
      Login Stockbit
    </button>
  );
}

// ─── Reusable Components ───────────────────────────────────────────────────

function Section({
  step,
  title,
  subtitle,
  meta,
  children,
}: {
  step: string;
  title: string;
  subtitle?: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/30 shadow-sm">
      <header className="flex items-start justify-between gap-4 border-b border-zinc-800 px-5 py-3.5">
        <div className="flex items-start gap-3">
          <span className="rounded bg-zinc-800/80 px-2 py-0.5 font-mono text-xs text-zinc-400">
            {step}
          </span>
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
            {subtitle && (
              <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>
            )}
          </div>
        </div>
        {meta && (
          <span className="rounded-md bg-zinc-800/60 px-2.5 py-1 text-xs font-medium text-zinc-300">
            {meta}
          </span>
        )}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

function ChipButton({
  active,
  onClick,
  badge,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  badge?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
        active
          ? "border-emerald-700 bg-emerald-500/20 text-emerald-200"
          : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-800/70 hover:text-zinc-200"
      }`}
    >
      {children}
      {badge !== undefined && (
        <span className="text-[10px] opacity-70">{badge}</span>
      )}
    </button>
  );
}

function ActionButton({
  onClick,
  disabled,
  variant = "default",
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "success" | "warning" | "danger";
  children: React.ReactNode;
}) {
  const colors = {
    default: "hover:border-zinc-700 hover:text-zinc-200",
    success: "hover:border-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-300",
    warning: "hover:border-amber-700 hover:bg-amber-500/10 hover:text-amber-300",
    danger: "hover:border-rose-700 hover:bg-rose-500/10 hover:text-rose-300",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border border-zinc-800 bg-zinc-900/70 px-2.5 py-1 text-xs font-medium text-zinc-400 transition disabled:cursor-not-allowed disabled:opacity-50 ${colors[variant]}`}
    >
      {children}
    </button>
  );
}

function OptionCard({
  type,
  name,
  checked,
  disabled,
  onChange,
  badge,
  children,
}: {
  type: "checkbox" | "radio";
  name?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2.5 text-sm transition ${
        checked
          ? "border-emerald-700 bg-emerald-500/5 text-zinc-100"
          : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900/40"
      } ${disabled ? "opacity-60" : ""}`}
    >
      <input
        type={type}
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="h-4 w-4 accent-emerald-500"
      />
      <span className="flex-1">{children}</span>
      {badge && (
        <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          {badge}
        </span>
      )}
    </label>
  );
}

// ─── Job Panel ─────────────────────────────────────────────────────────────

function EmptyJobPanel() {
  return (
    <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/20 p-8 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800/50">
        <svg
          className="h-5 w-5 text-zinc-500"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
          />
        </svg>
      </div>
      <p className="text-sm font-medium text-zinc-300">Belum ada scrape</p>
      <p className="mt-1 text-xs text-zinc-500">
        Pilih emiten dan konfigurasi, kemudian klik “Mulai Scrape”.
      </p>
    </div>
  );
}

function JobPanel({ job }: { job: JobStatus }) {
  const pct = job.progress.total
    ? Math.round((job.progress.current / job.progress.total) * 100)
    : 0;
  const isActive = job.state === "running";

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 shadow-sm">
      <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
        <div>
          <div className="text-sm font-semibold text-zinc-100">Job Aktif</div>
          <div className="font-mono text-[11px] text-zinc-500">{job.jobId}</div>
        </div>
        <StateBadge state={job.state} />
      </header>

      <div className="px-5 py-4">
        {job.currentPhase && isActive && (
          <div className="mb-3 flex items-center gap-2 text-xs">
            <span className="text-zinc-500">Fase:</span>
            <span className="rounded-md bg-sky-500/15 px-2 py-0.5 font-medium text-sky-300">
              {job.currentPhase === "annual" ? "Tahunan" : "Kuartalan"}
            </span>
          </div>
        )}

        <div className="mb-2 flex justify-between text-sm">
          <span className="font-medium text-zinc-200">
            {job.progress.current} / {job.progress.total}
            <span className="ml-1 text-zinc-500">ticker</span>
          </span>
          <span className="font-mono text-sm font-semibold text-zinc-300">
            {pct}%
          </span>
        </div>
        <div className="mb-4 h-2 overflow-hidden rounded-full bg-zinc-800">
          <div
            className={`h-full rounded-full transition-all ${
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
          <div className="mb-4 space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Unduh
            </div>
            {job.outputs.map((o) => (
              <a
                key={o.filename}
                href={`/api/scrape/${job.jobId}/download?file=${encodeURIComponent(o.filename)}`}
                className="flex items-center justify-between gap-3 rounded-md border border-emerald-700/50 bg-emerald-500/10 px-3.5 py-2.5 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/20"
                download
              >
                <span className="inline-flex items-center gap-2">
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    />
                  </svg>
                  {o.period === "annual" ? "Data Tahunan" : "Data Kuartalan"}
                </span>
                <span className="font-mono text-xs text-emerald-300/80">
                  {formatBytes(o.sizeBytes)}
                </span>
              </a>
            ))}
          </div>
        )}

        {job.error && (
          <div className="mb-4 rounded-md border border-rose-900/50 bg-rose-500/10 p-3 text-xs text-rose-300">
            <div className="mb-1 font-semibold">Error</div>
            {job.error}
          </div>
        )}

        <details open={isActive}>
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-300">
            Log Eksekusi
          </summary>
          <pre className="mt-3 max-h-80 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-emerald-300/90">
            {job.logTail.join("\n") || "(belum ada output)"}
          </pre>
        </details>
      </div>
    </div>
  );
}

function StateBadge({ state }: { state: JobStatus["state"] }) {
  const config = {
    queued: { label: "Antrian", style: "bg-zinc-800 text-zinc-400" },
    running: {
      label: "Berjalan",
      style: "bg-sky-500/15 text-sky-300 ring-1 ring-inset ring-sky-500/30",
    },
    done: {
      label: "Selesai",
      style:
        "bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30",
    },
    failed: {
      label: "Gagal",
      style:
        "bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-500/30",
    },
  };
  const c = config[state];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${c.style}`}
    >
      {state === "running" && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      )}
      {c.label}
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
  CHANNEL_AUTHENTICATOR: "Aplikasi Authenticator",
};

const PHASE_TITLES: Record<LoginPhase, string> = {
  credentials: "Masuk ke Stockbit",
  choose_channel: "Pilih Metode Verifikasi",
  enter_otp: "Masukkan Kode OTP",
  next_factor: "Verifikasi Tambahan",
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
      if (!r.ok) throw new Error(String(data.error || "Gagal"));
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
          completedChannels:
            (data.channelsCompleted as string[]) || prev.completedChannels,
          currentChannel: null,
        }));
        setOtp("");
        return;
      default:
        setErr(`Mode tidak dikenal: ${mode}`);
    }
  }

  const previewStr = (() => {
    if (!ctx.preview) return null;
    const p = ctx.preview as Record<string, string>;
    return p.email || p.whatsapp || p.phone || p.target || null;
  })();

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <h2 className="text-base font-semibold text-zinc-100">
            {PHASE_TITLES[ctx.phase]}
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
            aria-label="Tutup"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Progress indicator (skip on credentials) */}
        {ctx.phase !== "credentials" && (
          <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900/50 px-6 py-2.5 text-xs">
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <CheckIcon /> Kredensial
            </span>
            {ctx.completedChannels.map((c) => (
              <span
                key={c}
                className="inline-flex items-center gap-1 text-emerald-400"
              >
                <CheckIcon />
                {CHANNEL_LABELS[c] ?? c}
              </span>
            ))}
            <span className="inline-flex items-center gap-1 text-amber-400">
              <DotIcon /> Sekarang
            </span>
          </div>
        )}

        <div className="px-6 py-5">
          {ctx.phase === "credentials" && (
            <div className="space-y-4">
              <FormField label="Email atau Username">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                  placeholder="nama@email.com"
                  className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600/30"
                />
              </FormField>
              <FormField label="Password">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600/30"
                />
              </FormField>
              <button
                onClick={() => void post({ email, password })}
                disabled={posting || !email || !password}
                className="w-full rounded-md bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
              >
                {posting ? "Memproses…" : "Masuk"}
              </button>
              <p className="text-xs text-zinc-500">
                Kredensial hanya digunakan untuk menjalankan{" "}
                <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[11px] text-zinc-300">
                  login_token.py
                </code>{" "}
                secara lokal. Token akan disimpan terenkripsi di state directory.
              </p>
            </div>
          )}

          {(ctx.phase === "choose_channel" ||
            ctx.phase === "next_factor") && (
            <div className="space-y-4">
              <div className="rounded-md border border-amber-900/40 bg-amber-500/10 p-3 text-sm text-amber-200">
                {ctx.phase === "next_factor"
                  ? "Stockbit memerlukan verifikasi tambahan. Pilih channel berikutnya."
                  : "Stockbit mendeteksi perangkat baru. Pilih channel untuk pengiriman kode OTP."}
              </div>
              <div className="space-y-2">
                {(ctx.availableChannels.length
                  ? ctx.availableChannels
                  : ["CHANNEL_EMAIL", "CHANNEL_WHATSAPP", "CHANNEL_SMS"]
                ).map((c) => (
                  <button
                    key={c}
                    onClick={() => void post({ requestOtp: c })}
                    disabled={posting}
                    className="flex w-full items-center justify-between rounded-md border border-zinc-800 bg-zinc-950 px-4 py-3 text-left text-sm transition hover:border-emerald-700 hover:bg-emerald-500/5 disabled:opacity-50"
                  >
                    <span className="font-medium text-zinc-100">
                      {CHANNEL_LABELS[c] ?? c}
                    </span>
                    <span className="text-zinc-500">→</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {ctx.phase === "enter_otp" && (
            <div className="space-y-4">
              <div className="rounded-md border border-sky-900/40 bg-sky-500/10 p-3 text-sm text-sky-200">
                Kode OTP telah dikirim melalui{" "}
                <strong>
                  {CHANNEL_LABELS[ctx.currentChannel ?? ""] ??
                    ctx.currentChannel}
                </strong>
                {previewStr ? ` ke ${previewStr}` : ""}.
              </div>
              <FormField label="Kode OTP">
                <input
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  autoFocus
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="••••••"
                  className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3.5 py-3 text-center font-mono text-2xl tracking-[0.5em] outline-none placeholder:text-zinc-700 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600/30"
                />
              </FormField>
              <button
                onClick={() => void post({ otp })}
                disabled={posting || otp.length !== 6}
                className="w-full rounded-md bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
              >
                {posting ? "Memverifikasi…" : "Verifikasi"}
              </button>
              <button
                onClick={() =>
                  setCtx((prev) => ({
                    ...prev,
                    phase: "choose_channel",
                    currentChannel: null,
                  }))
                }
                className="w-full text-xs text-zinc-500 transition hover:text-zinc-300"
              >
                ← Ganti channel
              </button>
            </div>
          )}

          {err && (
            <div className="mt-4 rounded-md border border-rose-900/50 bg-rose-500/10 p-3 text-xs text-rose-300">
              {err}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-zinc-400">
        {label}
      </label>
      {children}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 13l4 4L19 7"
      />
    </svg>
  );
}

function DotIcon() {
  return (
    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function daysAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 3600 * 1000));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
