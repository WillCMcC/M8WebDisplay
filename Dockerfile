FROM node:20-alpine AS builder
RUN apk add --no-cache make perl git
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN make all

FROM nginx:alpine
COPY --from=builder /app/build/ /usr/share/nginx/html/
COPY --from=builder /app/app.webmanifest /usr/share/nginx/html/
EXPOSE 80
