FROM node:20-slim AS base
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npx prisma generate --schema=src/db/prisma/schema.prisma
EXPOSE 3001
CMD ["npm", "run", "dev"]
