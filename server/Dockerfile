# 聊天服务端镜像。better-sqlite3 是原生模块，用带编译工具链的镜像装依赖，
# 再把产物拷进精简的运行镜像。
FROM node:22-bookworm-slim AS build

WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY server/package.json server/
# 只装 server 和 shared 这两个 workspace，跳过 App 的一大堆 RN 依赖
RUN npm install --workspace @chat/shared --workspace @chat/server --include-workspace-root

COPY packages/shared packages/shared
COPY server server
RUN npm run build --workspace @chat/shared \
    && npm run build --workspace @chat/server

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV CHAT_DATA_DIR=/data
WORKDIR /app

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build /repo/packages/shared/package.json ./packages/shared/
COPY --from=build /repo/server/dist ./server/dist
COPY --from=build /repo/server/package.json ./server/

VOLUME ["/data"]
EXPOSE 4000

# CHAT_JWT_SECRET 必须在运行时注入，生产环境缺失会直接启动失败
CMD ["node", "server/dist/index.js"]
