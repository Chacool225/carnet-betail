# Image de production de l'API (non testée dans l'environnement où elle a été écrite : voir docs/DEPLOY.md)
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/contract/package.json packages/contract/
RUN pnpm install
COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY packages/contract packages/contract
RUN pnpm --filter @carnet/api build && pnpm --filter @carnet/api deploy --prod /out

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/migrations ./migrations
COPY --from=build /app/packages/contract/openapi.yaml ./openapi.yaml
ENV OPENAPI_PATH=./openapi.yaml
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
