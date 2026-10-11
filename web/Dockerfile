# Hive web image (build context: the repo root). Railway: set RAILWAY_DOCKERFILE_PATH=web/Dockerfile,
# NEXT_PUBLIC_SERVER_URL to the server's public URL, and PORT=5173.
FROM node:22
RUN npm i -g pnpm@12.11.2
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared ./shared
COPY server/package.json ./server/package.json
COPY web ./web
RUN pnpm i --frozen-lockfile --filter web...
ARG NEXT_PUBLIC_SERVER_URL
ENV NEXT_PUBLIC_SERVER_URL=$NEXT_PUBLIC_SERVER_URL
RUN pnpm --filter web build
CMD ["pnpm", "--filter", "web", "start"]
