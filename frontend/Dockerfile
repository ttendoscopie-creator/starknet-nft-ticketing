# Stage 1: Install deps + build
FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production image
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production

RUN groupadd -r appuser && useradd -r -g appuser -s /bin/false appuser

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public

USER appuser
EXPOSE 3000
CMD ["npm", "start"]
