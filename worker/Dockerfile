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

# yt-dlp ships as a standalone binary and updates far more often than any
# distro package — pin a release and bump it deliberately.
ARG YTDLP_VERSION=2025.01.26
RUN curl -fsSL \
      "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp_linux" \
      -o /usr/local/bin/yt-dlp \
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
