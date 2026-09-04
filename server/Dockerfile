# Always-on Node process. Socket.io needs a persistent connection, so this must
# be deployed as a long-running container — never a serverless/edge function.
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install deps first so the layer caches across code changes.
COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
# db/schema.sql is read by db.migrate() on boot.
COPY db ./db

# Drop privileges.
USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3001)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "src/index.js"]
