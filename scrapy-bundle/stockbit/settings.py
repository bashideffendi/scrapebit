import os

# Scrapy settings for stockbit project
#
# For simplicity, this file contains only settings considered important or
# commonly used. You can find more settings consulting the documentation:
#
#     https://docs.scrapy.org/en/latest/topics/settings.html
#     https://docs.scrapy.org/en/latest/topics/downloader-middleware.html
#     https://docs.scrapy.org/en/latest/topics/spider-middleware.html

BOT_NAME = 'stockbit'

SPIDER_MODULES = ['stockbit.spiders']
NEWSPIDER_MODULE = 'stockbit.spiders'


USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

ROBOTSTXT_OBEY = False

# === Rate Limiting ===
# Set RATE_LIMIT_ENABLED = True untuk mode aman (ada delay & throttle)
# Set RATE_LIMIT_ENABLED = False untuk full speed (tanpa limit)
RATE_LIMIT_ENABLED = True

if RATE_LIMIT_ENABLED:
    CONCURRENT_REQUESTS = 16
    CONCURRENT_REQUESTS_PER_DOMAIN = 8
    DOWNLOAD_DELAY = 0.5
    RANDOMIZE_DOWNLOAD_DELAY = True
else:
    CONCURRENT_REQUESTS = 32
    CONCURRENT_REQUESTS_PER_DOMAIN = 32
    DOWNLOAD_DELAY = 0
    RANDOMIZE_DOWNLOAD_DELAY = False

# === Proxy ===
# Set PROXY_ENABLED = True lalu isi PROXY_URL untuk route semua request lewat proxy
# Format: http://user:pass@host:port atau http://host:port
PROXY_ENABLED = False
PROXY_URL = os.environ.get("PROXY_URL", "http://127.0.0.1:8080")

if PROXY_ENABLED:
    HTTPPROXY_ENABLED = True
    HTTP_PROXY = PROXY_URL
    HTTPS_PROXY = PROXY_URL

LOG_LEVEL = "ERROR"

# Disable cookies (enabled by default)
#COOKIES_ENABLED = False

# Disable Telnet Console (enabled by default)
#TELNETCONSOLE_ENABLED = False

DEFAULT_REQUEST_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
    "Origin": "https://stockbit.com",
    "Referer": "https://stockbit.com/",
    "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
}

# Enable or disable spider middlewares
# See https://docs.scrapy.org/en/latest/topics/spider-middleware.html
#SPIDER_MIDDLEWARES = {
#    'stockbit.middlewares.StockbitSpiderMiddleware': 543,
#}

# Enable or disable downloader middlewares
# See https://docs.scrapy.org/en/latest/topics/downloader-middleware.html
#DOWNLOADER_MIDDLEWARES = {
#    'stockbit.middlewares.StockbitDownloaderMiddleware': 543,
#}

# Enable or disable extensions
# See https://docs.scrapy.org/en/latest/topics/extensions.html
#EXTENSIONS = {
#    'scrapy.extensions.telnet.TelnetConsole': None,
#}

# Configure item pipelines
# See https://docs.scrapy.org/en/latest/topics/item-pipeline.html
#ITEM_PIPELINES = {
#    'stockbit.pipelines.StockbitPipeline': 300,
#}

# AutoThrottle otomatis naikin delay kalau server mulai lambat/429
AUTOTHROTTLE_ENABLED = RATE_LIMIT_ENABLED
AUTOTHROTTLE_START_DELAY = 0.5
AUTOTHROTTLE_MAX_DELAY = 15
AUTOTHROTTLE_TARGET_CONCURRENCY = 4.0

RETRY_TIMES = 5
RETRY_HTTP_CODES = [429, 500, 502, 503, 504]
RETRY_PRIORITY_ADJUST = -1

# Enable and configure HTTP caching (disabled by default)
# See https://docs.scrapy.org/en/latest/topics/downloader-middleware.html#httpcache-middleware-settings
#HTTPCACHE_ENABLED = True
#HTTPCACHE_EXPIRATION_SECS = 0
#HTTPCACHE_DIR = 'httpcache'
#HTTPCACHE_IGNORE_HTTP_CODES = []
#HTTPCACHE_STORAGE = 'scrapy.extensions.httpcache.FilesystemCacheStorage'

FEEDS = {
    # Default output filename. Backward-compatible with `json_to_excel_table_format.py`
    # which reads `output.json`.
    #
    # For the quarterly spider, pass -O explicitly to avoid overwriting the annual
    # output:
    #     scrapy crawl stockbit_quarterly_spider -O output_quarterly.json
    "output.json": {
        "format": "json",
        "encoding": "utf8",
        "store_empty": False,
        "fields": None,
        "indent": 2,
    },
}
