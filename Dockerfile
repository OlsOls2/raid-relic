FROM node:24.22.1-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY src/ ./src/
COPY public/ ./public/
COPY LICENSE ./LICENSE
ARG RELEASE_COMMIT
ENV RELEASE_COMMIT=${RELEASE_COMMIT}
RUN node --input-type=module -e 'import { validateReleaseCommit } from "./src/release.js"; validateReleaseCommit(process.env.RELEASE_COMMIT, { required: true });'
LABEL org.opencontainers.image.revision=${RELEASE_COMMIT}
USER node
EXPOSE 8080
CMD ["node", "src/server.js"]
