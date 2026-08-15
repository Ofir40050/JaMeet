FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/server/package.json apps/server/package.json
RUN npm install --workspace=@musiczoom/shared --workspace=@musiczoom/server --include-workspace-root
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN npm run build -w @musiczoom/shared && npm run build -w @musiczoom/server

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
USER node
CMD ["node", "apps/server/dist/index.js"]
