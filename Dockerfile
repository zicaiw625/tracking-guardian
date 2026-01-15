FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

# Install dependencies
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY extensions ./extensions
RUN pnpm install --frozen-lockfile --filter ./...

# Copy source
COPY . .

# Generate Prisma client
RUN pnpm generate

# Inject BACKEND_URL and validate extensions (must pass or build fails)
RUN pnpm ext:inject || (echo "ERROR: BACKEND_URL injection failed. Set SHOPIFY_APP_URL environment variable." && exit 1)
RUN pnpm ext:validate || (echo "ERROR: Extension validation failed. Fix errors before building." && exit 1)

# Build the app
RUN pnpm build

FROM node:22-alpine AS runner

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

RUN addgroup -S app && adduser -S app -G app

ENV NODE_ENV=production
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=true

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY extensions ./extensions

# Install only production dependencies
RUN pnpm install --prod --ignore-scripts --frozen-lockfile --filter ./...

# Copy Prisma CLI (dev dependency) from builder for runtime migrations
COPY --from=builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma

# Copy build output and Prisma schema
COPY --from=builder /app/build ./build
COPY --from=builder /app/prisma ./prisma

RUN chown -R app:app /app

USER app

EXPOSE 3000

CMD ["pnpm", "docker-start"]
