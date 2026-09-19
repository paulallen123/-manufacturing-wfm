FROM node:22.16.0-bookworm-slim
WORKDIR /app
COPY package.json server.cjs ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node","server.cjs"]
