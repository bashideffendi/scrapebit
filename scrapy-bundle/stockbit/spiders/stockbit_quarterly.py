"""
Quarterly variant of the main Stockbit financial spider.

Same code path as `stockbit_spider`, but passes statement_type=1 (Quarterly)
to the Stockbit API instead of statement_type=2 (Annual). Period headers
returned by Stockbit are cumulative YTD (3M / 6M / 9M / 12M), and the base
parser `_parse_period_header` canonicalises them to:
    3M  -> <year>-Q1
    6M  -> <year>-H1
    9M  -> <year>-9M
    12M -> <year>   (full year, same as annual)

Post-processing (in lib/ of the dashboard) can derive Q2 = H1 - Q1,
Q3 = 9M - H1, Q4 = FY - 9M to get discrete quarter values.

Run separately from the annual spider:
    scrapy crawl stockbit_quarterly_spider -O output_quarterly.json
"""

from stockbit.spiders.stockbit import StockbitSpider


class StockbitQuarterlySpider(StockbitSpider):
    name = "stockbit_quarterly_spider"
    statement_type = 1
    period_prefix = ""  # varies (3M / 6M / 9M / 12M)
