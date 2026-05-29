# syntax=docker/dockerfile:1.6

# ─── Stage 1: build Next.js ────────────────────────────────────────────────
FROM node:20-bookworm-slim AS web-builder
WORKDIR /app

# Install deps with cache
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy source
COPY tsconfig.json next.config.* postcss.config.* eslint.config.* ./
COPY app ./app
COPY lib ./lib
COPY data ./data
COPY public ./public

# Build (standalone biar runtime image kecil)
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build


# ─── Stage 2: Python + scrapy bundle ───────────────────────────────────────
FROM python:3.12-slim-bookworm AS python-runtime
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates curl libxml2 libxslt1.1 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app/scrapy-bundle
COPY scrapy-bundle/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY scrapy-bundle/ ./


# ─── Stage 3: final runtime — Node + Python combo ─────────────────────────
FROM python:3.12-slim-bookworm AS runtime
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates curl libxml2 libxslt1.1 dumb-init && \
    # Install Node 20 from nodesource
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

# Copy Python site-packages + scrapy bundle from stage 2
COPY --from=python-runtime /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=python-runtime /usr/local/bin /usr/local/bin
COPY --from=python-runtime /app/scrapy-bundle /app/scrapy-bundle

# Copy Next.js build (standalone) from stage 1
WORKDIR /app
COPY --from=web-builder /app/.next/standalone ./
COPY --from=web-builder /app/.next/static ./.next/static
COPY --from=web-builder /app/public ./public
COPY --from=web-builder /app/data ./data

# Entrypoint bootstrap
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Env defaults
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    SCRAPER_SOURCE_DIR=/app/scrapy-bundle \
    STATE_DIR=/data \
    PYTHON_BIN=/usr/local/bin/python3 \
    SCRAPY_BIN=/usr/local/bin/scrapy \
    PYTHONUNBUFFERED=1

EXPOSE 3000
# NOTE: tidak pakai VOLUME directive — Railway tolak itu. Mount /data via
# Railway Volumes feature di dashboard (Settings → Volumes). Buat platform
# lain (Fly, Docker host), tambahin `-v scrapebit-data:/data` di run.

ENTRYPOINT ["/usr/bin/dumb-init", "--", "docker-entrypoint.sh"]
CMD ["node", "server.js"]
