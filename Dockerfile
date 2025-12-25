FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# Copy source
COPY . .

# Generate Prisma client
RUN yarn generate

# Build the app
RUN yarn build

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=true

COPY package.json yarn.lock ./

# Install only production dependencies
RUN yarn install --frozen-lockfile --production --ignore-scripts

# Copy Prisma CLI (dev dependency) from builder for runtime migrations
COPY --from=builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma

# Copy build output and Prisma schema
COPY --from=builder /app/build ./build
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000

CMD ["yarn", "docker-start"]
