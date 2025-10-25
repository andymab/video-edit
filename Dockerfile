# syntax=docker/dockerfile:1.7

############################
# Base image (Node 24)
############################
FROM node:24-alpine AS base
WORKDIR /app
ENV CI=true \
    HOST=0.0.0.0 \
    PORT=5173 \
    NODE_ENV=development

############################
# Dev image (HMR)
############################
FROM base AS dev
# Если используете pnpm/yarn — раскомментируйте corepack
# RUN corepack enable

# Копируем только манифесты для кэша зависимостей (root-level)
COPY package.json package-lock.json* yarn.lock* pnpm-lock.yaml* ./
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Копируем остальной код (root)
COPY . .

EXPOSE 5173
# Для Vite-проектов — dev-сервер с HMR наружу
CMD ["npm","run","dev","--","--host","0.0.0.0","--port","5173"]

############################
# Prod build
############################
FROM base AS build
ENV NODE_ENV=production

# Манифесты из корня
COPY package.json package-lock.json* yarn.lock* pnpm-lock.yaml* ./
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Исходники из корня
COPY . .
RUN npm run build

############################
# Prod runtime (static preview)
############################
FROM node:24-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4173

# Лёгкий предпросмотр собранного dist через vite preview
COPY --from=build /app/package.json .
RUN --mount=type=cache,target=/root/.npm npm i --no-save vite
COPY --from=build /app/dist ./dist

EXPOSE 4173
CMD ["npx","vite","preview","--host","0.0.0.0","--port","4173"]
