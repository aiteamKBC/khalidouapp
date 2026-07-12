FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_API_BASE_URL
ARG VITE_DESKTOP_DOWNLOAD_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_DESKTOP_DOWNLOAD_URL=${VITE_DESKTOP_DOWNLOAD_URL}
ENV NITRO_PRESET=node-server
ENV KHALIDUO_OUTPUT_DIR=.output
ENV KHALIDUO_BUILD_DIR=node_modules/.nitro-docker

RUN test -n "$VITE_API_BASE_URL" && test -n "$VITE_DESKTOP_DOWNLOAD_URL" && npm run build


FROM node:22-alpine AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

WORKDIR /app

COPY --from=build /app/.output ./.output

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
