FROM node:26.7.0-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY ./patches ./patches
RUN npm ci
COPY . .
RUN npm run build --omit=dev

FROM node:26.7.0-alpine
WORKDIR /app
COPY --from=builder /app/build build/
COPY --from=builder /app/node_modules node_modules/
COPY package.json .
EXPOSE 3000
ENV NODE_ENV=production
CMD [ "node", "build" ]
