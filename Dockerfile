FROM node:22-bookworm-slim AS build

ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:proxy && npm prune --omit=dev

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4173 \
    RAMMERHEAD_HOST=0.0.0.0 \
    RAMMERHEAD_PORT=4174 \
    DATABASE_PATH=/app/data/nightjar.sqlite

WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server.js /app/admin-cli.js ./
COPY --from=build --chown=node:node /app/public ./public
RUN mkdir -p /app/data && chown node:node /app/data

USER node
CMD ["node", "server.js"]
