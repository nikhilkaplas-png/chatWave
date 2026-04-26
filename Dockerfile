# Pure JS deps. Railway/Docker often crashes npm ("Exit handler never called");
# install with Corepack + pnpm instead (see pnpm-lock.yaml).

FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable

COPY package.json pnpm-lock.yaml ./

RUN corepack prepare pnpm@9.15.4 --activate \
    && pnpm install --prod --frozen-lockfile \
    && test -f node_modules/express/package.json \
    && node -e "require('express'); console.log('deps ok')"

COPY . .

EXPOSE 3001

# Avoid npm as PID 1; matches production start and cleaner signals.
CMD ["node", "src/index.js"]
