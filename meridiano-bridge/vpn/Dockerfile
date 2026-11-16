FROM node:24-bookworm-slim
WORKDIR /app
COPY worker.mjs ./worker.mjs
COPY vpn/relay.mjs vpn/server.mjs ./vpn/
CMD ["node", "vpn/server.mjs"]
