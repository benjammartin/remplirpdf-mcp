# RemplirPDF MCP server (stdio). Builds the TypeScript server and runs it; no proxy, no mcp-remote.
#   docker build -t remplirpdf-mcp .
#   docker run -i --rm -e REMPLIRPDF_API_KEY=rpdf_… remplirpdf-mcp
# Without REMPLIRPDF_API_KEY the server still starts and lists its tools; calls explain how to set the key.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --no-audit --no-fund
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
ENTRYPOINT ["node", "dist/index.js"]
