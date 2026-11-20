FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    python3 \
    make \
    g++ \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json next.config.ts postcss.config.mjs ./
COPY src ./src

ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production
RUN pnpm build

RUN mkdir -p /app/var /repos && chown -R node:node /app /repos
USER node

ENV FACTORY_BIND=0.0.0.0:3000 \
    FACTORY_REPOS_DIR=/repos \
    FACTORY_ROOT=/app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>r.json()).then(j=>process.exit(j.db?0:1)).catch(()=>process.exit(1))"]

CMD ["pnpm", "start"]
