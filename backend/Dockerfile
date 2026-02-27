# Stage 1: Install all deps + build
FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npx prisma generate --schema=src/db/prisma/schema.prisma
RUN npm run build

# Stage 2: Production image with only runtime deps
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production

RUN groupadd -r appuser && useradd -r -g appuser -s /bin/false appuser

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy built output and Prisma generated client
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/src/db/prisma ./src/db/prisma

USER appuser
EXPOSE 3001
CMD ["node", "dist/api/server.js"]
