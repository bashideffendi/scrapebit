"""Dedupe symbol.json → processed_symbols.json (ticker+name only).

Path arg-aware buat support Docker/Railway:
    python process_symbols.py                            # default cwd-relative
    python process_symbols.py --input symbol.json --output processed_symbols.json
"""

import argparse
import json
import os
from pathlib import Path


def process_symbols(input_path: str, output_path: str) -> None:
    with open(input_path, 'r') as f:
        data = json.load(f)

    # Dedupe: last occurrence wins
    unique_symbols: dict = {}
    for item in data:
        symbol = item['ticker']
        name = item.get('name', '')
        unique_symbols[symbol] = {'ticker': symbol, 'name': name}

    result = list(unique_symbols.values())
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w') as f:
        json.dump(result, f, indent=2)
    print(f"[PROCESS] {len(data)} entries -> {len(result)} unique -> {output_path}")


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    state_dir = os.environ.get("SCRAPEBIT_STATE_DIR") or "."
    p.add_argument("--input", default=os.path.join(state_dir, "symbol.json"))
    p.add_argument("--output", default=os.path.join(state_dir, "processed_symbols.json"))
    args = p.parse_args()
    process_symbols(args.input, args.output)
