# Build from the repository root:  docker build -f backend/Dockerfile -t lcsync-backend .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY extension/package.json extension/
RUN npm ci --workspace @lcsync/backend --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY backend backend
RUN npm run build -w @lcsync/backend

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY extension/package.json extension/
RUN npm ci --workspace @lcsync/backend --omit=dev && npm cache clean --force
COPY --from=build /app/backend/dist backend/dist
USER node
EXPOSE 4000
# Migrations run automatically on startup.
CMD ["node", "backend/dist/main.js"]
