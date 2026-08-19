FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY backend/node-api ./backend/node-api
COPY supabase/functions/app-api ./supabase/functions/app-api
RUN npm run build:api && npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S nodeapi && adduser -S nodeapi -G nodeapi
COPY --from=build --chown=nodeapi:nodeapi /app/package.json ./package.json
COPY --from=build --chown=nodeapi:nodeapi /app/node_modules ./node_modules
COPY --from=build --chown=nodeapi:nodeapi /app/backend/node-api/dist ./backend/node-api/dist
USER nodeapi
EXPOSE 8787
CMD ["node", "backend/node-api/dist/server.mjs"]

