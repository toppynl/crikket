FROM oven/bun:1.3.5-alpine AS base
WORKDIR /app

FROM base AS install
COPY bun.lock* package.json ./
COPY apps/jobs-cloudrun/package.json ./apps/jobs-cloudrun/
COPY packages/ ./packages/
RUN bun install --frozen-lockfile

FROM base AS runner
COPY --from=install /app .
COPY apps/jobs-cloudrun/ ./apps/jobs-cloudrun/
CMD ["bun", "run", "apps/jobs-cloudrun/src/index.ts"]
