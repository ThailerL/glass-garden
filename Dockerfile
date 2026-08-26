FROM node:26.7.0-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY ./patches ./patches
RUN npm ci
COPY . .
RUN npm run build

FROM node:26.7.0-alpine
WORKDIR /app
COPY --from=builder /app/build build/
EXPOSE 3000
ENV NODE_ENV=production
CMD [ "node", "build" ]
