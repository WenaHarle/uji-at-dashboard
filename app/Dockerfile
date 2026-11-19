FROM node:24-alpine
RUN apk add --no-cache openssl tini
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
COPY public ./public
COPY certs ./certs
ENV NODE_ENV=production
EXPOSE 8900
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
