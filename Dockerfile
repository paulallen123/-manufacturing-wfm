FROM node:22.16.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends tar gzip && rm -rf /var/lib/apt/lists/*
WORKDIR /bootstrap
COPY bootstrap.cjs /bootstrap/bootstrap.cjs
COPY artifact/ /bootstrap/artifact/
ENV NODE_ENV=staging
EXPOSE 3000
CMD ["node","/bootstrap/bootstrap.cjs"]
