from scrapy.http import JsonRequest
from stockbit.items import StockbitItem
from stockbit.spiders.base import StockbitBaseSpider


class SymbolSpider(StockbitBaseSpider):
    name = "symbol"
    symbol_count = 0

    def start_requests(self):
        print("[CRAWL] Fetching sectors...")
        sectors_url = "https://exodus.stockbit.com/emitten/sectors"
        yield JsonRequest(
            url=sectors_url,
            method="GET",
            headers=self.auth_headers(),
            callback=self.parse_sectors,
        )

    def parse_sectors(self, response):
        data = response.json().get("data")
        print(f"[CRAWL] {len(data)} sectors ditemukan")
        for sector in data:
            subsectors_url = f"https://exodus.stockbit.com/emitten/sectors/{sector.get('id')}/subsectors"
            yield JsonRequest(
                url=subsectors_url,
                method="GET",
                headers=self.auth_headers(),
                callback=self.parse_subsectors,
                cb_kwargs={
                    'sector_name': sector.get('name'),
                    'sector_id': sector.get('id')
                }
            )

    def parse_subsectors(self, response, sector_name, sector_id):
        data = response.json().get("data")
        print(f"[CRAWL] Sector '{sector_name}': {len(data)} subsectors")
        for subsector in data:
            companies_url = f"https://exodus.stockbit.com/emitten/v3/sector/{subsector.get('parent')}/subsector/{subsector.get('id')}/company"
            yield JsonRequest(
                url=companies_url,
                method="GET",
                headers=self.auth_headers(),
                callback=self.parse_companies,
                cb_kwargs={
                    'sector_name': sector_name,
                    'subsector_name': subsector.get('name')
                }
            )

    def parse_companies(self, response, sector_name, subsector_name):
        data = response.json().get("data")
        for company in data:
            self.symbol_count += 1
            ticker = company.get("symbol")
            if self.symbol_count % 50 == 0:
                print(f"[CRAWL] {self.symbol_count} symbols collected... (latest: {ticker})")
            yield StockbitItem(
                ticker=ticker,
                name=company.get("name"),
                sector=sector_name,
                subsector=subsector_name
            )