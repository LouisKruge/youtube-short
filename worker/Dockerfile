# Nexus Clips worker — Node + ffmpeg + yt-dlp.
#
# Deploy this to Railway, Render, Fly.io, or any container host. It is NOT
# optional: the Vercel app cannot run ffmpeg or yt-dlp, so without this
# service the pipeline stops at "queued for download".

FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 \
      python3-pip \
      ca-certificates \
      curl \
      fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# OpenCV, for the face-aware vertical crop.
#
# The pip wheel rather than Debian's python3-opencv: the wheel bundles the Haar
# cascade XML inside the package, where cv2.data.haarcascades points at it. The
# Debian package splits them into opencv-data at a different path, so the script
# would have to guess where the cascades live. (It handles both anyway, but one
# fewer thing to be wrong about.)
#
# -headless is the same library without the GUI bindings, which need X11 and are
# meaningless in a container. --break-system-packages because Debian 12 marks
# the system Python as externally managed; this image has one Python and one
# consumer of it, so there is nothing to conflict with.
RUN pip install --no-cache-dir --break-system-packages \
      "opencv-python-headless<5" \
    && python3 -c "import cv2, os; assert os.path.exists(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'); print('opencv', cv2.__version__)"

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
# Resolved at runtime relative to dist/pipeline/, so it must sit beside dist/.
COPY scripts ./scripts
RUN npm install typescript --no-save && npx tsc && npm prune --omit=dev

ENV NODE_ENV=production
ENV MEDIA_DIR=/tmp/nexus-media
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/index.js"]
