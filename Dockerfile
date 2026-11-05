# syntax=docker/dockerfile:1
#
# One image for the whole app: the API server, which also hosts the built web
# app, so everything is served from a single origin.
#
#   build   - installs everything and builds the server and the web app
#   migrate - applies database migrations, then exits (run before the app)
#   runtime - only what's needed to run: production dependencies and the
#             built files, no compilers, no npm, running as a non-root user

FROM node:26-alpine AS base
WORKDIR /app

# ---- build ----
FROM base AS build
# Prisma's config needs a URL even for `prisma generate`, which doesn't connect.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY package.json package-lock.json .npmrc ./
COPY server/package.json server/
COPY client/package.json client/
COPY e2e/package.json e2e/
# .npmrc makes this refuse any package install script that isn't reviewed.
RUN npm ci --no-fund --no-audit
COPY server server
COPY client client
RUN npm run db:generate -w server \
 && npm run build -w server \
 && npm run build -w client

# ---- migrate ----
FROM build AS migrate
WORKDIR /app/server
CMD ["npx", "prisma", "migrate", "deploy"]

# ---- runtime ----
FROM base AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    STATIC_DIR=/app/server/public
COPY package.json package-lock.json .npmrc ./
COPY server/package.json server/
COPY client/package.json client/
COPY e2e/package.json e2e/
# The Prisma CLI is both a dev dependency and an optional peer of @prisma/client,
# so npm only leaves it out (with TypeScript and Prisma Studio hanging off it)
# when dev, optional and peer packages are all omitted. The running server
# never uses them; migrations run in the migrate image. Saves about 250 MB.
RUN npm ci --omit=dev --omit=optional --omit=peer --workspace server --no-fund --no-audit \
 && npm cache clean --force \
 # npm isn't needed to run the app; removing it shrinks the image and what can be attacked.
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist server/public

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server/dist/index.js"]
