FROM node:20-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

# Install dependencies
COPY package.json pnpm-workspace.yaml ./
COPY extensions ./extensions
RUN pnpm install --filter ./...

# Copy source
COPY . .

# Generate Prisma client
RUN pnpm generate

# Build the app
RUN pnpm build

FROM node:20-alpine AS runner

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

ENV NODE_ENV=production
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=true

COPY package.json pnpm-workspace.yaml ./
COPY extensions ./extensions

# Install only production dependencies
RUN pnpm install --prod --ignore-scripts --filter ./...

# Copy Prisma CLI (dev dependency) from builder for runtime migrations
COPY --from=builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma

# Copy build output and Prisma schema
COPY --from=builder /app/build ./build
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000

CMD ["pnpm", "docker-start"]
