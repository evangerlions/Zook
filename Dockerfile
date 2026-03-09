FROM node:22-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:22-alpine AS runtime

WORKDIR /app

ARG APP_NAME=zook
ARG APP_VERSION=dev
ARG GIT_SHA=unknown
ARG BUILD_DATE=unknown

ENV NODE_ENV=production
ENV PORT=3100

LABEL org.opencontainers.image.title=$APP_NAME
LABEL org.opencontainers.image.version=$APP_VERSION
LABEL org.opencontainers.image.revision=$GIT_SHA
LABEL org.opencontainers.image.created=$BUILD_DATE

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node src ./src

USER node

EXPOSE 3100

CMD ["node", "--experimental-transform-types", "src/main.ts"]
