# Hive server image (build context: the repo root). Railway: set RAILWAY_DOCKERFILE_PATH=server/Dockerfile.
# The full node image is used because the server shells out to git.
FROM node:22
RUN npm i -g pnpm@12.11.2
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared ./shared
COPY web/package.json ./web/package.json
COPY server ./server
RUN pnpm i --frozen-lockfile --filter server...
CMD ["pnpm", "--filter", "server", "start"]
