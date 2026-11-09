FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY config.example.yaml ./config.example.yaml
VOLUME ["/data"]
EXPOSE 8787
CMD ["node","dist/cli.js","api","/data/eventide.yaml"]
