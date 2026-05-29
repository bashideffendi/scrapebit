"""Classify tickers in symbol.json into saham / non-saham, write tickers_saham.json.

Path arg-aware buat support Docker/Railway:
    python filter_saham.py                       # cwd-relative default
    python filter_saham.py --input symbol.json --output tickers_saham.json
"""
import argparse
import json
import os
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).parent

SAHAM_SECTORS = {
    "Energi", "Barang Baku", "Perindustrian", "Transportasi & Logistik",
    "Barang Konsumen Primer", "Barang Konsumen Non-Primer", "Kesehatan",
    "Keuangan", "Properti & Real Estate", "Teknologi", "Infrastruktur",
    "Listing Board", "Delisted Stock",
}
SAHAM_SUBSECTORS = {
    "Saham", "Papan Akselerasi", "Papan Utama", "Papan Pengembangan",
    "IDXFINANCE", "IDXCYCLIC", "IDXNONCYC", "IDXPROPERT", "IDXHEALTH",
    "IDXENERGY", "IDXBASIC", "IDXINDUST", "IDXTRANS", "IDXTECHNO", "IDXINFRA",
}
NON_SAHAM_SUBSECTORS = {
    "CALL WARRANT", "PUT WARRANT", "ETF", "Obligasi", "Pasar Uang",
    "FR Bonds", "Cryptocurrency", "Currencies", "Commodities",
    "Global Index",
}


def classify(input_path: str, output_path: str):
    data = json.loads(Path(input_path).read_text(encoding="utf-8"))
    grouped = defaultdict(set)
    names = {}
    for r in data:
        t = r["ticker"]
        grouped[t].add((r["sector"], r["subsector"]))
        names[t] = r["name"]

    saham = []
    for t, pairs in grouped.items():
        sectors = {p[0] for p in pairs}
        subs = {p[1] for p in pairs}
        if sectors & {"FR Bonds"} or subs & NON_SAHAM_SUBSECTORS:
            continue
        if sectors & SAHAM_SECTORS or subs & SAHAM_SUBSECTORS:
            saham.append({
                "ticker": t,
                "name": names[t],
                "sectors": sorted(sectors),
                "subsectors": sorted(subs),
            })

    saham.sort(key=lambda r: r["ticker"])
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(saham, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[OK] {len(saham)} saham -> {out.name}")
    return saham


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    state_dir = os.environ.get("SCRAPEBIT_STATE_DIR") or str(ROOT)
    p.add_argument("--input", default=os.path.join(state_dir, "symbol.json"))
    p.add_argument("--output", default=os.path.join(state_dir, "tickers_saham.json"))
    args = p.parse_args()
    classify(args.input, args.output)
