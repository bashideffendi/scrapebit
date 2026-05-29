import json
import re
import scrapy
from scrapy.http import JsonRequest
from stockbit.spiders.base import StockbitBaseSpider


# ─── Helper parsers ─────────────────────────────────────────────────────────
# Stockbit keystats returns values as formatted strings.
# "123.28 B" → 123_280_000_000.0
# "801,288 B" → 801_288_000_000_000.0
# "42.59%" → 0.4259
# "14,146 B" → 14_146_000_000_000.0
# "114.75" → 114.75
# "-" or "" → None

_SUFFIX_MUL = {"T": 1e12, "B": 1e9, "M": 1e6, "K": 1e3, "JT": 1e6, "RB": 1e3}


def _parse_idx_number(val):
    """Parse Stockbit's formatted number (with T/B/M/K suffix) to float."""
    if val is None or val == "" or val == "-":
        return None
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).strip().replace(",", "").replace("(", "-").replace(")", "")
    m = re.match(r"^(-?\d+(?:\.\d+)?)\s*([A-Za-z]+)?$", s)
    if not m:
        try:
            return float(s)
        except (TypeError, ValueError):
            return None
    num = float(m.group(1))
    suffix = (m.group(2) or "").upper()
    mul = _SUFFIX_MUL.get(suffix, 1.0)
    return num * mul


def _parse_idx_percent(val):
    """Parse "42.59%" → 0.4259; fraction form stays as-is."""
    if val is None or val == "" or val == "-":
        return None
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).strip().replace(",", "")
    if s.endswith("%"):
        try:
            return float(s[:-1]) / 100.0
        except ValueError:
            return None
    try:
        return float(s)
    except ValueError:
        return None


# =============================================================================
# Metric name mapping (EXPANDED — v2)
#
# Upstream Stockbit labels (Bahasa Indonesia) -> our canonical English-ish key.
# Keys for statement rows are prefixed:
#   income_statement_<label>
#   balance_sheet_<label>
#   cash_flow_<label>
# Key Ratio rows use the raw label (no prefix).
#
# IMPORTANT: Mapping is still a whitelist — only listed source labels pass
# through. Unknown rows are ignored (keeps output shape stable). Add new rows
# here rather than auto-passing everything, to avoid duplicate-semantic columns.
# =============================================================================
METRIC_MAPPING = {
    # -------------------------------------------------------------------
    # Income Statement
    # -------------------------------------------------------------------
    "income_statement_Total Pendapatan": "Revenue",
    "income_statement_Pendapatan Bunga": "Interest Income",
    "income_statement_Provisi Dan Komisi Kredit": "Fee & Commission Income",
    "income_statement_Total Beban Pokok Penjualan": "Beban Pkk Penjualan",
    "income_statement_Beban Bunga": "Interest Expense",
    "income_statement_Laba Kotor": "Gross Profit",
    "income_statement_Total Beban Usaha": "Biaya Operasional",
    "income_statement_Beban Tenaga Kerja": "Employee Expense",
    "income_statement_Beban Umum Dan Administrasi": "G&A Expense",
    "income_statement_Beban Penyisihan Kerugian": "Loan Loss Provision",
    "income_statement_Beban Penjualan": "Selling Expense",
    "income_statement_Laba Usaha": "EBIT",
    "income_statement_Penghasilan/Beban Lain-Lain": "Other Income/Expense",
    "income_statement_Beban Keuangan": "Biaya Keuangan",
    "income_statement_Laba Sebelum Pajak": "Pre-Tax Income",
    "income_statement_Pajak Kini": "Current Tax",
    "income_statement_Pajak Tangguhan": "Deferred Tax",
    "income_statement_Total Beban Pajak Penghasilan": "Income Tax Expense",
    "income_statement_Laba Bersih Tahun Berjalan": "Net Income Total",
    "income_statement_Pemilik Entitas Induk": "Net Profit",
    "income_statement_Kepentingan Non-Pegendali": "Minority Interest Income",
    "income_statement_Pendapatan Komprehensif Lain": "OCI",
    "income_statement_Jumlah Laba Komprehensif": "Comprehensive Income",

    # -------------------------------------------------------------------
    # Balance Sheet — Assets
    # -------------------------------------------------------------------
    "balance_sheet_Kas Dan Setara Kas": "Cash",
    "balance_sheet_Piutang Usaha": "Piutang",
    "balance_sheet_Persediaan": "Persediaan",
    "balance_sheet_Aset Lancar": "Aset Lancar",
    "balance_sheet_Aset Tidak Lancar": "Aset Tidak Lancar",
    "balance_sheet_Total Aset": "Total Assets",
    "balance_sheet_Aset Tetap": "Fixed Assets",
    "balance_sheet_Aset Tak Berwujud": "Intangible Assets",
    "balance_sheet_Aset Pajak Tangguhan": "Deferred Tax Assets",
    "balance_sheet_Piutang Pembiayaan Konsumen": "Consumer Financing Receivables",
    "balance_sheet_Obligasi Pemerintah": "Government Bonds",

    # -------------------------------------------------------------------
    # Balance Sheet — Liabilities
    # -------------------------------------------------------------------
    "balance_sheet_Liabilitas Jangka Pendek": "Liab J Pndk",
    "balance_sheet_Liabilitas Jangka Panjang": "Liab J Pnjg",
    "balance_sheet_Total Liabilitas": "Total Liabilitas",
    "balance_sheet_Liabilitas Pajak Tangguhan": "Deferred Tax Liabilities",

    # -------------------------------------------------------------------
    # Balance Sheet — Bank-specific
    # -------------------------------------------------------------------
    "balance_sheet_Simpanan Nasabah": "Customer Deposits",
    "balance_sheet_Giro Pada Bank Indonesia": "BI Current Account",
    "balance_sheet_Penempatan Pada Bank Indonesia": "BI Placements",
    "balance_sheet_Pinjaman Yang Diberikan": "Loans Given",
    "balance_sheet_Simpanan Dari Bank Lain": "Interbank Deposits",
    "balance_sheet_Liabilitas Bank Lain": "Other Bank Liabilities",
    "balance_sheet_Liabilitas Akseptasi": "Acceptance Liabilities",
    "balance_sheet_Surat Berharga Yang Diterbitkan": "Issued Securities",
    "balance_sheet_Pinjaman Yang Diterima": "Borrowings",
    "balance_sheet_Obligasi Subordinasi": "Subordinated Bonds",
    "balance_sheet_Dana Syirkah Temporer": "Syirkah Temporer Funds",
    "balance_sheet_Liabilitas Segera": "Immediate Liabilities",

    # -------------------------------------------------------------------
    # Balance Sheet — Equity
    # -------------------------------------------------------------------
    "balance_sheet_Ekuitas": "Ekuitas",
    "balance_sheet_Total Ekuitas": "Total Equity",
    "balance_sheet_Total Liabilitas Dan Ekuitas": "Total Liab + Equity",
    "balance_sheet_Modal Saham": "Share Capital",
    "balance_sheet_Tambahan Modal Disetor": "Additional Paid-in Capital",
    "balance_sheet_Saldo Laba": "Retained Earnings",
    "balance_sheet_Kepentingan Non Pengendali": "Minority Interest",
    "balance_sheet_Saham Beredar": "Shares Outstanding (BS)",

    # -------------------------------------------------------------------
    # Cash Flow — totals & line items
    # -------------------------------------------------------------------
    "cash_flow_Arus Kas Dari Aktivitas Operasi": "CFO",
    "cash_flow_Arus Kas Dari Aktivitas Investasi": "Cash flow from investor",
    "cash_flow_Arus Kas Dari Aktivitas Pendanaan": "Cash flow from finance",
    "cash_flow_Kenaikan (Penurunan) Bersih Kas": "Net Change in Cash",
    "cash_flow_Kas Dan Setara Kas Awal Periode": "Cash Begin Period",
    "cash_flow_Kas Dan Setara Kas Akhir Periode": "Cash End Period",

    # Cash flow — operating detail
    "cash_flow_Penerimaan Pendapatan Bunga": "Cash Interest Received",
    "cash_flow_Pembayaran Beban Bunga, Provisi Dan Komisi": "Cash Interest Paid",
    "cash_flow_Pembayaran Pajak Penghasilan": "Cash Tax Paid",
    "cash_flow_Pembayaran Imbalan Pasca-Kerja": "Cash Pension Paid",
    "cash_flow_Pembayaran Tantiem Dewan Komisaris Dan Direksi": "Cash Directors Bonus",

    # Cash flow — investing detail
    "cash_flow_Perolehan Aset Tetap": "Capex Fixed Assets",
    "cash_flow_Perolehan Aset Sewa Guna": "Capex Leased Assets",
    "cash_flow_Hasil Penjualan Aset Tetap": "Fixed Asset Sale Proceeds",
    "cash_flow_Penerimaan Dividen Kas Dari Investasi": "Dividends Received (CF)",
    "cash_flow_Pembelian Efek-Efek Untuk Investasi": "Securities Purchased",
    "cash_flow_Penerimaan Dari Efek-Efek Investasi": "Securities Sold",

    # Cash flow — financing detail
    "cash_flow_Pembayaran Dividen Kas": "Cash Dividends Paid",
    "cash_flow_Pembelian Kembali Saham Beredar": "Share Buyback",
    "cash_flow_Hasil Penjualan Saham Treasury": "Treasury Stock Sold",
    "cash_flow_Penerimaan Dari Obligasi Subordinasi": "Subordinated Bond Proceeds",
    "cash_flow_Penerimaan Dari Penambahan Modal Disetor": "Paid-in Capital Received",

    # -------------------------------------------------------------------
    # Key Ratios (no prefix — raw label)
    # -------------------------------------------------------------------
    "Operating Cash Flow (Annual)": "Operating Cash Flow",
    "Free cash flow (Annual)": "Free Cash Flow",
    "Free cash flow per share (Annual)": "FCF per Share",
    "Capital expenditure (Annual)": "Capital expend",
    "Book Value Per Share (Annual)": "BVPS",
    "Tang. Book Value Per Share (Annual)": "Tangible BVPS",
    "Price to Book Value (Annual)": "PBV",
    "Price to Tang. Book Value (Annual)": "Price to Tangible BV",
    "EPS (Annual)": "EPS",
    "PE Ratio (Annual)": "PE Ratio",
    "Price to Sales (Annual)": "P/S",
    "EBITDA (Annual)": "EBITDA",
    "Return on Assets (Annual)": "ROA",
    "Return on Equity (Annual)": "ROE",
    "Return on Capital Employed (Annual)": "ROCE",
    "Return On Invested Capital (Annual)": "ROIC",
    "Interest Coverage (Annual)": "Interest Coverage",
    "Total Liabilities/Equity (Annual)": "Total Liab to Equity",
    "Debt to Equity Ratio (Annual)": "Debt to Equity",
    "LT Debt/Equity (Annual)": "LT Debt to Equity",
    "Total Debt/Total Assets (Annual)": "Debt to Assets",
    "Net Debt/Total Equity (Annual)": "Net Debt to Equity",
    "Short-term Debt (Annual)": "ST Debt",
    "Long-term Debt (Annual)": "LT Debt",
    "Total Debt (Annual)": "Total Debt",
    "Net Debt (Annual)": "Net Debt",
    "Working capital (Annual)": "Working Capital",
    "Current Ratio (Annual)": "Current Ratio",
    "Quick Ratio (Annual)": "Quick Ratio",
    "Financial Leverage (Annual)": "Financial Leverage",
    "Asset Turnover (Annual)": "Asset Turnover",
    "Fixed Assets Turnover (Annual)": "Fixed Asset Turnover",
    "Inventory Turnover (Annual)": "Inventory Turnover",
    "Receivables Turnover (Annual)": "Receivables Turnover",
    "Days Sales Outstanding (Annual)": "DSO",
    "Days Inventory (Annual)": "Days Inventory",
    "Payables Period (Annual)": "DPO",
    "Cash Conversion Cycle (Annual)": "Cash Conversion Cycle",
    "Working Capital Turnover (Annual)": "Working Capital Turnover",
    "Working Capital Ratio (Annual)": "Working Capital Ratio",
}


class StockbitSpider(StockbitBaseSpider):
    name = "stockbit_spider"
    symbols = []

    # statement_type=2 -> Annual, statement_type=1 -> Quarterly.
    # Subclassed by stockbit_quarterly_spider with statement_type=1.
    statement_type = 2
    period_prefix = "12M"   # quarterly spider overrides

    def __init__(self, *args, symbol_file=None, years=None, skip_endpoints=None, **kwargs):
        super().__init__(*args, **kwargs)
        # `-a symbol_file=tickers_saham.json` — pakai list saham bersih (1032)
        # daripada default processed_symbols.json (1953 termasuk bond/sukuk/ETF).
        path = symbol_file or 'processed_symbols.json'
        try:
            with open(path, 'r') as f:
                self.symbols = json.load(f)
            print(f"[CRAWL] Loaded {len(self.symbols)} symbols from {path}")
        except Exception as e:
            self.logger.error(f"Error loading symbols file '{path}': {e}")
            self.symbols = []

        # `-a years=2020-2025` — filter period output ke rentang tahun.
        # Format: "YYYY-YYYY". Periods di luar rentang di-drop di parse layer.
        self.year_from = None
        self.year_to = None
        if years:
            try:
                a, b = years.split('-', 1)
                self.year_from = int(a)
                self.year_to = int(b)
                print(f"[CRAWL] Year filter: {self.year_from}-{self.year_to}")
            except (ValueError, AttributeError):
                print(f"[CRAWL] WARN: invalid years '{years}', ignored")

        # `-a skip_endpoints=dividend,emitten_info,price_performance` —
        # skip optional endpoint setelah cash_flow (annual only).
        self.skip_endpoints = set()
        if skip_endpoints:
            self.skip_endpoints = {s.strip() for s in skip_endpoints.split(',') if s.strip()}
            if self.skip_endpoints:
                print(f"[CRAWL] Skip endpoints: {sorted(self.skip_endpoints)}")

    def _period_in_range(self, period_key):
        """True kalau period key (mis. '2025' atau '2025-Q1') ada di year_from..year_to."""
        if self.year_from is None or self.year_to is None or not period_key:
            return True
        try:
            year = int(str(period_key).split('-')[0])
            return self.year_from <= year <= self.year_to
        except (ValueError, IndexError):
            return True

    def start_requests(self):
        self.total_symbols = len(self.symbols)
        print(f"[CRAWL] Mulai scraping {self.total_symbols} symbols ({self._period_label()})")
        for i, symbol_data in enumerate(self.symbols, 1):
            symbol = symbol_data.get('ticker')
            if symbol:
                self._current_index = i
                yield from self.fetch_symbol(symbol)

    def _period_label(self):
        return "Annual" if self.statement_type == 2 else "Quarterly"

    def fetch_symbol(self, symbol):
        financial_url = (
            f"https://exodus.stockbit.com/findata-view/company/financial"
            f"?symbol={symbol}&data_type=1&report_type=1&statement_type={self.statement_type}"
        )
        yield JsonRequest(
            url=financial_url,
            method="GET",
            headers=self.auth_headers(),
            callback=self.parse_symbol,
            cb_kwargs={'symbol': symbol}
        )

    # -------------------------------------------------------------------
    # Period header parsing — handles both annual (12M25) and quarterly
    # (3M25 = Q1, 6M25 = H1, 9M25 = 9M, 12M25 = FY). Quarterly cells are
    # cumulative (YTD), so to get Qn-only we subtract the previous in Phase 2
    # post-processing. For the raw scrape we keep what Stockbit returns and
    # label it sensibly.
    # -------------------------------------------------------------------
    def _parse_period_header(self, header):
        """Convert raw period label to a canonical period key.

        Annual format (statement_type=2):
          '12M25' -> '2025'

        Quarterly format (statement_type=1) — Stockbit changed format ~2026 from
        cumulative YTD ('3M25','6M25','9M25','12M25') to **discrete quarters**:
          'Q108' -> '2008-Q1'
          'Q425' -> '2025-Q4'
          'Q126' -> '2026-Q1'

        Legacy cumulative format kept for backward compat in case API flips back.
        """
        if not header:
            return None
        h = header.strip()

        # Discrete quarters: Q<n><yy>  e.g. Q108, Q425, Q126
        if h.startswith('Q') and len(h) >= 4:
            try:
                quarter = int(h[1])
                year_part = h[2:]
                if quarter in (1, 2, 3, 4) and year_part.isdigit():
                    year = year_part if len(year_part) == 4 else '20' + year_part
                    return f"{year}-Q{quarter}"
            except (ValueError, IndexError):
                pass

        # Cumulative YTD or annual: 3M25/6M25/9M25/12M25
        if 'M' not in h:
            return None
        try:
            month_part, year_part = h.split('M', 1)
            months = int(month_part)
            year = year_part if len(year_part) == 4 else '20' + year_part
        except (ValueError, IndexError):
            return None

        if months == 12:
            return year
        if months == 3:
            return f"{year}-Q1"
        if months == 6:
            return f"{year}-H1"
        if months == 9:
            return f"{year}-9M"
        return f"{year}-{months}M"

    def _extract_periods(self, selector):
        headers = selector.css('th.periods-list::attr(data-label)').getall()
        return [self._parse_period_header(h) for h in headers]

    def parse_symbol(self, response, symbol):
        self.crawler.stats.inc_value('symbols_processed')
        done = self.crawler.stats.get_value('symbols_processed', 0)
        print(f"[CRAWL] [{done}/{self.total_symbols}] {symbol} - income statement")
        data = response.json().get("data")
        html = data.get("html_report")
        financial_data = {
            "tick": symbol,
            "name": "",
            "sector": "",
            "subsector": ""
        }
        selector = scrapy.Selector(text=html)
        periods = self._extract_periods(selector)

        for row in selector.css('tr.dtr'):
            source_metric_name = row.css('span.acc-name::attr(data-lang-0-full)').get()
            if not source_metric_name:
                continue

            metric_name = self.map_metric_name('income_statement_' + source_metric_name)
            if not metric_name:
                continue

            year_data = {}
            cells = row.css('td.rowval')
            for i, cell in enumerate(cells):
                if i >= len(periods) or periods[i] is None:
                    continue
                period = periods[i]
                if not self._period_in_range(period):
                    continue
                value = cell.attrib.get('data-value-idr', '0')
                try:
                    value = float(value)
                except (ValueError, TypeError):
                    value = 0
                year_data[period] = value

            if year_data and metric_name not in financial_data:
                financial_data[metric_name] = year_data

        balance_sheet_url = (
            f"https://exodus.stockbit.com/findata-view/company/financial"
            f"?symbol={symbol}&data_type=1&report_type=2&statement_type={self.statement_type}"
        )
        yield JsonRequest(
            url=balance_sheet_url,
            method="GET",
            headers=self.auth_headers(),
            callback=self.parse_balance_sheet,
            cb_kwargs={'symbol': symbol, 'income_statement': financial_data}
        )

    def parse_balance_sheet(self, response, symbol, income_statement):
        print(f"[CRAWL] {symbol} - balance sheet")
        data = response.json().get("data")
        html = data.get("html_report")
        selector = scrapy.Selector(text=html)

        financial_data = {
            "tick": symbol,
            "name": "",
            "sector": "",
            "subsector": ""
        }
        periods = self._extract_periods(selector)

        for row in selector.css('tr.dtr'):
            source_metric_name = row.css('span.acc-name::attr(data-lang-0-full)').get()
            if not source_metric_name:
                continue

            # Skip rows that are sub-indented (start with space) — avoids grabbing
            # sub-category duplicates.
            if source_metric_name.startswith(' '):
                continue

            metric_name = self.map_metric_name('balance_sheet_' + source_metric_name)
            if not metric_name:
                continue

            year_data = {}
            cells = row.css('td.rowval')
            for i, cell in enumerate(cells):
                if i >= len(periods) or periods[i] is None:
                    continue
                period = periods[i]
                if not self._period_in_range(period):
                    continue
                value = cell.attrib.get('data-value-idr', '0')
                try:
                    value = float(value)
                except (ValueError, TypeError):
                    value = 0
                year_data[period] = value

            if year_data and metric_name not in financial_data:
                financial_data[metric_name] = year_data

        cash_flow_url = (
            f"https://exodus.stockbit.com/findata-view/company/financial"
            f"?symbol={symbol}&data_type=1&report_type=3&statement_type={self.statement_type}"
        )
        yield JsonRequest(
            url=cash_flow_url,
            method="GET",
            headers=self.auth_headers(),
            callback=self.parse_cash_flow,
            cb_kwargs={'symbol': symbol, 'balance_sheet': financial_data, 'income_statement': income_statement}
        )

    def parse_cash_flow(self, response, symbol, balance_sheet, income_statement):
        print(f"[CRAWL] {symbol} - cash flow")
        data = response.json().get("data")
        html = data.get("html_report")
        selector = scrapy.Selector(text=html)

        financial_data = {
            "tick": symbol,
            "name": "",
            "sector": "",
            "subsector": ""
        }
        periods = self._extract_periods(selector)

        for row in selector.css('tr.dtr'):
            source_metric_name = row.css('span.acc-name::attr(data-lang-0-full)').get()
            if not source_metric_name:
                continue

            if source_metric_name.startswith(' '):
                continue

            metric_name = self.map_metric_name('cash_flow_' + source_metric_name)
            if not metric_name:
                continue

            year_data = {}
            cells = row.css('td.rowval')
            for i, cell in enumerate(cells):
                if i >= len(periods) or periods[i] is None:
                    continue
                period = periods[i]
                if not self._period_in_range(period):
                    continue
                value = cell.attrib.get('data-value-idr', '0')
                try:
                    value = float(value)
                except (ValueError, TypeError):
                    value = 0
                year_data[period] = value

            if year_data and metric_name not in financial_data:
                financial_data[metric_name] = year_data

        # Key Ratios table (only present on annual view)
        for row in selector.css('#data_table_keyratio_1 tr.dtr'):
            source_metric_name = row.css('span.acc-name::attr(data-lang-0-full)').get()
            if not source_metric_name:
                continue

            metric_name = self.map_metric_name(source_metric_name)
            if not metric_name:
                continue

            year_data = {}
            cells = row.css('td.row-ratio-val')
            for i, cell in enumerate(cells):
                if i >= len(periods) or periods[i] is None:
                    continue
                period = periods[i]
                if not self._period_in_range(period):
                    continue
                value = cell.attrib.get('data-value-idr', '0')
                try:
                    value = float(value)
                except (ValueError, TypeError):
                    value = 0
                year_data[period] = value

            if year_data and metric_name not in financial_data:
                financial_data[metric_name] = year_data

        # Fetch dividend (only meaningful for annual spider; quarterly skips).
        # Also skip kalau user pakai -a skip_endpoints=dividend,...
        if self.statement_type == 2 and 'dividend' not in self.skip_endpoints:
            dividend_url = f"https://exodus.stockbit.com/keystats/ratio/v1/{symbol}?year_limit=10"
            yield JsonRequest(
                url=dividend_url,
                method="GET",
                headers=self.auth_headers(),
                callback=self.parse_dividend,
                cb_kwargs={
                    'symbol': symbol,
                    'balance_sheet': balance_sheet,
                    'income_statement': income_statement,
                    'cash_flow': financial_data,
                }
            )
        elif self.statement_type == 2:
            # Dividend skipped — try to go to next non-skipped step
            yield from self._chain_after_dividend(symbol, balance_sheet, income_statement, financial_data)
        else:
            # Quarterly spider: skip dividend endpoint, emit combined data now
            yield self._merge_item(symbol, balance_sheet, income_statement, financial_data)

    def _chain_after_dividend(self, symbol, balance_sheet, income_statement, cash_flow):
        """Setelah skip dividend, lompat ke emitten_info / price_performance / finalize."""
        if 'emitten_info' not in self.skip_endpoints:
            emitten_url = f"https://exodus.stockbit.com/emitten/{symbol}/info"
            yield JsonRequest(
                url=emitten_url,
                method="GET",
                headers=self.auth_headers(),
                callback=self.parse_emitten_info,
                cb_kwargs={
                    'symbol': symbol,
                    'balance_sheet': balance_sheet,
                    'income_statement': income_statement,
                    'cash_flow': cash_flow,
                },
            )
        elif 'price_performance' not in self.skip_endpoints:
            pp_url = f"https://exodus.stockbit.com/company-price-feed/price-performance/{symbol}"
            yield JsonRequest(
                url=pp_url,
                method="GET",
                headers=self.auth_headers(),
                callback=self.parse_price_performance,
                cb_kwargs={
                    'symbol': symbol,
                    'balance_sheet': balance_sheet,
                    'income_statement': income_statement,
                    'cash_flow': cash_flow,
                },
            )
        else:
            yield from self._finalize(symbol, balance_sheet, income_statement, cash_flow)

    def parse_dividend(self, response, symbol, balance_sheet, income_statement, cash_flow):
        print(f"[CRAWL] {symbol} - keystats")
        data = response.json().get("data") or {}

        # ── 1. Dividend events (per-payment detail) + aggregated per-year ──
        dividend_data = data.get("dividend_group", {}).get("dividend_year_values", []) or []
        dividend_per_year = {}
        dividend_events = []
        for entry in dividend_data:
            year = str(entry.get("period"))
            # Dividend values from Stockbit can be: None, "-", "", "281.00", "1,358.18"
            # Use _parse_idx_number to handle comma thousand separators robustly.
            dividend = _parse_idx_number(entry.get("dividend")) or 0.0
            dividend_per_year[year] = dividend_per_year.get(year, 0.0) + dividend
            if dividend > 0:
                dividend_events.append({
                    "period": year,
                    "dividend": dividend,
                    "ex_date": entry.get("ex_date") or entry.get("exDate"),
                    "pay_date": entry.get("pay_date") or entry.get("payDate") or entry.get("payment_date"),
                    "recording_date": entry.get("recording_date") or entry.get("recordingDate"),
                    "type": entry.get("dividend_type") or entry.get("type"),
                })

        # ── 2. stats block (free_float, shares outstanding, market cap, EV) ──
        # Values are formatted strings like "123.28 B" or "42.59%" or "801,288 B".
        # We parse to raw numbers where sensible + keep original formatted strings.
        stats_raw = data.get("stats") or {}
        emitten_stats = {
            "currentShareOutstanding_str": stats_raw.get("current_share_outstanding"),
            "marketCap_str": stats_raw.get("market_cap"),
            "enterpriseValue_str": stats_raw.get("enterprise_value"),
            "freeFloat_str": stats_raw.get("free_float"),
            # Parsed numeric versions
            "currentShareOutstanding": _parse_idx_number(stats_raw.get("current_share_outstanding")),
            "marketCap": _parse_idx_number(stats_raw.get("market_cap")),
            "enterpriseValue": _parse_idx_number(stats_raw.get("enterprise_value")),
            "freeFloatPct": _parse_idx_percent(stats_raw.get("free_float")),
        }

        # ── 3. Quarterly breakdown per fitem (Net Income / EPS / Revenue) ──
        # Structure: financial_year_parent.financial_year_groups[i] with keys
        # fitem_name, financial_year_values[year].period_values[Q1-Q4]
        # We flatten to our time-series shape: {"<year>-Q<n>": value}
        quarterly_series = {}
        fyp = (data.get("financial_year_parent") or {}).get("financial_year_groups") or []
        for group in fyp:
            name = group.get("fitem_name")
            if not name:
                continue
            series = {}
            for yr_entry in group.get("financial_year_values", []) or []:
                year = str(yr_entry.get("year"))
                for pv in yr_entry.get("period_values", []) or []:
                    period = pv.get("period")  # "Q1" / "Q2" / etc
                    val = _parse_idx_number(pv.get("quarter_value"))
                    if period and val is not None:
                        series[f"{year}-{period}"] = val
            if series:
                quarterly_series[f"{name} (Quarterly)"] = series

        # ── 4. closure_fin_items_results: snapshot valuation items ──
        # These are derived from current price + financials, so typically we
        # skip them (we compute better ones in dashboard). But we stash the
        # raw dict in case of future need.
        closure_items = {}
        for grp in data.get("closure_fin_items_results", []) or []:
            for item in grp.get("fin_name_results", []) or []:
                fi = item.get("fitem") or {}
                nm = fi.get("name")
                val = fi.get("value")
                if nm:
                    closure_items[nm] = val

        # Stash for merge at the end
        balance_sheet = dict(balance_sheet)
        balance_sheet["_emitten_stats"] = emitten_stats
        balance_sheet["_quarterly_series"] = quarterly_series
        balance_sheet["_closure_items"] = closure_items
        balance_sheet["_dividend_per_year"] = dividend_per_year
        balance_sheet["_dividend_events"] = dividend_events

        # Next: emitten info (listing details, CEO, sector names)
        # Skip kalau user pakai -a skip_endpoints=emitten_info,...
        if 'emitten_info' in self.skip_endpoints:
            yield from self._chain_after_emitten_info(symbol, balance_sheet, income_statement, cash_flow)
            return
        emitten_url = f"https://exodus.stockbit.com/emitten/{symbol}/info"
        yield JsonRequest(
            url=emitten_url,
            method="GET",
            headers=self.auth_headers(),
            callback=self.parse_emitten_info,
            cb_kwargs={
                'symbol': symbol,
                'balance_sheet': balance_sheet,
                'income_statement': income_statement,
                'cash_flow': cash_flow,
            },
            errback=lambda f, s=symbol, bs=balance_sheet, is_=income_statement, cf=cash_flow:
                self._skip_to_next(s, bs, is_, cf, 'emitten_info',
                                   next_step='price_performance'),
        )

    def _chain_after_emitten_info(self, symbol, balance_sheet, income_statement, cash_flow):
        """Setelah skip emitten_info, lompat ke price_performance / finalize."""
        if 'price_performance' not in self.skip_endpoints:
            pp_url = f"https://exodus.stockbit.com/company-price-feed/price-performance/{symbol}"
            yield JsonRequest(
                url=pp_url,
                method="GET",
                headers=self.auth_headers(),
                callback=self.parse_price_performance,
                cb_kwargs={
                    'symbol': symbol,
                    'balance_sheet': balance_sheet,
                    'income_statement': income_statement,
                    'cash_flow': cash_flow,
                },
            )
        else:
            yield from self._finalize(symbol, balance_sheet, income_statement, cash_flow)

    def parse_emitten_info(self, response, symbol, balance_sheet, income_statement, cash_flow):
        print(f"[CRAWL] {symbol} - emitten info")
        data = response.json().get("data") or {}

        # Capture raw scalar fields (free_float, listing_date, shares_outstanding, etc.)
        emitten_info = {}
        for k, v in data.items():
            if not isinstance(v, (dict, list)):
                emitten_info[k] = v

        balance_sheet = dict(balance_sheet)
        balance_sheet["_emitten_info"] = emitten_info

        # Next: price performance (1D/1W/.../10Y snapshots)
        # Skip kalau user pakai -a skip_endpoints=price_performance,...
        if 'price_performance' in self.skip_endpoints:
            yield from self._finalize(symbol, balance_sheet, income_statement, cash_flow)
            return
        pp_url = f"https://exodus.stockbit.com/company-price-feed/price-performance/{symbol}"
        yield JsonRequest(
            url=pp_url,
            method="GET",
            headers=self.auth_headers(),
            callback=self.parse_price_performance,
            cb_kwargs={
                'symbol': symbol,
                'balance_sheet': balance_sheet,
                'income_statement': income_statement,
                'cash_flow': cash_flow,
            },
            errback=lambda f, s=symbol, bs=balance_sheet, is_=income_statement, cf=cash_flow:
                self._skip_to_next(s, bs, is_, cf, 'price_performance',
                                   next_step='charts'),
        )

    def parse_price_performance(self, response, symbol, balance_sheet, income_statement, cash_flow):
        print(f"[CRAWL] {symbol} - price performance (done)")
        data = response.json().get("data") or {}

        # Normalize the `prices` array to a flat dict {timeframe: {low,high,close,percentage}}
        price_perf_normalized = {}
        for entry in (data.get("prices") or []):
            tf = entry.get("timeframe")
            if not tf:
                continue
            price_perf_normalized[tf] = {
                "close": (entry.get("close") or {}).get("raw"),
                "high": (entry.get("high") or {}).get("raw"),
                "low": (entry.get("low") or {}).get("raw"),
                "percentage": (entry.get("percentage") or {}).get("raw"),
            }

        balance_sheet = dict(balance_sheet)
        balance_sheet["_price_performance"] = price_perf_normalized

        # Daily OHLC chart endpoint requires a timeframe param we haven't mapped
        # cleanly — skip for now. PricePerformance above already exposes 52w
        # high/low (via the "1Y" timeframe) which is the main use case.
        yield from self._finalize(symbol, balance_sheet, income_statement, cash_flow)

    def _skip_to_next(self, symbol, balance_sheet, income_statement, cash_flow, failed_step, next_step):
        """Errback handler — some endpoints may 404 for delisted/suspended emitents.
        Log & continue to the next step gracefully."""
        print(f"[SKIP] {symbol} - {failed_step} failed, continuing to {next_step}")
        if next_step == 'price_performance':
            pp_url = f"https://exodus.stockbit.com/company-price-feed/price-performance/{symbol}"
            yield JsonRequest(
                url=pp_url,
                method="GET",
                headers=self.auth_headers(),
                callback=self.parse_price_performance,
                cb_kwargs={'symbol': symbol, 'balance_sheet': balance_sheet,
                           'income_statement': income_statement, 'cash_flow': cash_flow},
                errback=lambda f, s=symbol, bs=balance_sheet, is_=income_statement, cf=cash_flow:
                    self._finalize(s, bs, is_, cf),
            )
        else:
            yield from self._finalize(symbol, balance_sheet, income_statement, cash_flow)

    def _finalize(self, symbol, balance_sheet, income_statement, cash_flow):
        """Build the final item merging all sources."""
        emitten_stats = balance_sheet.pop("_emitten_stats", {})
        quarterly_series = balance_sheet.pop("_quarterly_series", {})
        closure_items = balance_sheet.pop("_closure_items", {})
        dividend_per_year = balance_sheet.pop("_dividend_per_year", {})
        dividend_events = balance_sheet.pop("_dividend_events", [])
        emitten_info = balance_sheet.pop("_emitten_info", {})
        price_performance = balance_sheet.pop("_price_performance", {})

        # Drop the placeholder meta fields from the statement dicts so they
        # don't override the good values from emitten_info when spread below.
        for d in (balance_sheet, income_statement, cash_flow):
            for k in ("tick", "name", "sector", "subsector"):
                d.pop(k, None)

        # Merge quarterly_series into balance_sheet as time-series fields
        balance_sheet.update(quarterly_series)

        financial_data = {
            **balance_sheet,
            **income_statement,
            **cash_flow,
            # Meta overrides (placed AFTER spreads so they win)
            "tick": symbol,
            "name": emitten_info.get("name") or emitten_info.get("company_name") or "",
            "sector": emitten_info.get("sector") or "",
            "subsector": emitten_info.get("sub_sector") or emitten_info.get("subsector") or "",
            # Supplementary raw blocks
            "Dividend": dividend_per_year,
            "DividendEvents": dividend_events,
            "EmittenStats": emitten_stats,
            "EmittenInfo": emitten_info,
            "PricePerformance": price_performance,
            "ClosureItems": closure_items,
        }
        yield financial_data

    def _merge_item(self, symbol, balance_sheet, income_statement, cash_flow):
        return {
            "tick": symbol,
            "name": "",
            "sector": "",
            "subsector": "",
            **balance_sheet,
            **income_statement,
            **cash_flow,
        }

    def map_metric_name(self, source_metric_name):
        return METRIC_MAPPING.get(source_metric_name, None)
