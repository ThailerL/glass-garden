FROM node:26.7.0-alpine AS builder
WORKDIR /app
# git is needed by scripts/vendor-assets.mjs, which clones Vivari at its release tag
RUN apk add --no-cache git
COPY package*.json ./
COPY ./patches ./patches
RUN npm ci
COPY . .
RUN npm run build

FROM node:26.7.0-alpine
WORKDIR /app
COPY --from=builder /app/build build/
COPY --from=builder /app/server.js ./
EXPOSE 3000
ENV NODE_ENV=production
CMD [ "node", "server.js" ]
