FROM node:24.22.1-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY src/ ./src/
COPY public/ ./public/
RUN chmod 0755 public/fonts && chmod 0644 public/fonts/Cinzel.ttf public/fonts/OFL-Cinzel.txt
COPY LICENSE ./LICENSE
ARG RELEASE_COMMIT
ENV RELEASE_COMMIT=${RELEASE_COMMIT}
RUN node --input-type=module -e 'import { validateReleaseCommit } from "./src/release.js"; validateReleaseCommit(process.env.RELEASE_COMMIT, { required: true });'
LABEL org.opencontainers.image.revision=${RELEASE_COMMIT}
USER node
RUN node -e 'const fs = require("node:fs"), crypto = require("node:crypto"); for (const [file, expected] of [["public/fonts/Cinzel.ttf", "f4d83d34d1f6c741193e4acf4b3dff9531e5a67b6aa65228d00a7db72a4e0f34"], ["public/fonts/OFL-Cinzel.txt", "f2b3029aba64c378bf0963b62945eee15e564fe4330b934c8f2eb058282b5e83"]]) { if (crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== expected) throw new Error("Public font integrity check failed"); }'
EXPOSE 8080
CMD ["node", "src/server.js"]
