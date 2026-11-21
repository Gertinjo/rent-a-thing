# ---- 1. build the phone web app ----
FROM node:24-slim AS web
WORKDIR /app/mobile
COPY mobile/package.json mobile/package-lock.json ./
RUN npm ci
COPY mobile/ ./
RUN npx expo export --platform web

# ---- 2. API + web app in one small image ----
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    DATABASE_URL=sqlite:////data/rentathing.db MEDIA_DIR=/data/media PRIVATE_DIR=/data/private
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY backend/admin_web ./admin_web
COPY --from=web /app/mobile/dist /app/mobile/dist
# run as an unprivileged user; database, photos and the secret key live in the /data volume
RUN useradd --create-home --uid 10001 app && mkdir -p /data && chown -R app /data /app/backend
USER app
VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"
# Set SECRET_KEY (and CORS_ORIGINS, TRUST_PROXY=1 behind a proxy) at run time.
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
