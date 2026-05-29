# Define here the models for your scraped items
#
# See documentation in:
# https://docs.scrapy.org/en/latest/topics/items.html

import scrapy


class StockbitItem(scrapy.Item):
    ticker = scrapy.Field()
    name = scrapy.Field()
    sector = scrapy.Field()
    subsector = scrapy.Field()
