# Nexus Clips worker — Node + ffmpeg + yt-dlp.
#
# Deploy this to Railway, Render, Fly.io, or any container host. It is NOT
# optional: the Vercel app cannot run ffmpeg or yt-dlp, so without this
# service the pipeline stops at "queued for download".

FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 \
      ca-certificates \
      curl \
      fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp tracks YouTube's player, which changes constantly — releases ship every
# few weeks precisely to keep up. A pinned version is reproducible right up
# until the day extraction breaks, and then it is simply broken: "Failed to
# extract any player response" is what a stale build looks like.
#
# So the default is the latest release at build time, and rebuilding is the fix
# when downloads start failing. Pass --build-arg YTDLP_VERSION=2026.07.01 to pin
# a known-good one deliberately.
ARG YTDLP_VERSION=latest
RUN if [ "$YTDLP_VERSION" = "latest" ]; then \
      URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux"; \
    else \
      URL="https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp_linux"; \
    fi \
    && curl -fsSL "$URL" -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && yt-dlp --version

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY tsconfig.json ./
COPY src ./src
RUN npm install typescript --no-save && npx tsc && npm prune --omit=dev

ENV NODE_ENV=production
ENV MEDIA_DIR=/tmp/nexus-media
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/index.js"]
