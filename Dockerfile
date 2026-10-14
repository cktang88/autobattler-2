# Ironclad Assembly: static client + async PvP server (single Node process, JSON files in /data).
# Node 22.18+ runs the TypeScript sources directly (type stripping), so there is no server build step.
FROM node:22.22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22.22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data TRUST_PROXY=1
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/public ./public
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
CMD ["node", "src/server/main.ts"]
