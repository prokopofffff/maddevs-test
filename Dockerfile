# Один процесс отдаёт API и собранный фронт (D-024); API запускается через tsx (D-044).
FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production
RUN pnpm install --frozen-lockfile --prod --filter @app/api
COPY apps/api apps/api
COPY --from=build /app/apps/web/dist apps/web/dist
EXPOSE 3000
CMD ["pnpm", "--filter", "@app/api", "start"]
