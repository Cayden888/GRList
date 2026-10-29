# Railway builds this automatically because it sits at the repository root.

# ---- Build stage: compile TypeScript ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- Run stage ----
FROM node:22-bookworm-slim
# IBM Plex for the control design, Noto CJK so Chinese titles render (no missing-glyph boxes).
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-ibm-plex fonts-noto-cjk fontconfig ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && fc-cache -f
ENV NODE_ENV=production \
    TZ=Asia/Kuala_Lumpur
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p output && chown node:node output
USER node
# A worker, not a web server: no port is exposed.
CMD ["node", "dist/index.js"]
