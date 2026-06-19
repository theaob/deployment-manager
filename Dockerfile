# ---- Build Stage ----
FROM node:20-alpine AS builder

# better-sqlite3 requires build tools for native compilation
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- Runtime Stage ----
FROM node:20-alpine

RUN apk add --no-cache tini

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY . .

# SQLite data volume
RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# tini for proper PID 1 signal handling
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
