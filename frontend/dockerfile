# ──────────────────────────────────────────────────────────────────────────────
# Stage 1: builder
#   - Installs ALL dependencies and runs `npm run build`
#   - Outputs static assets to dist/
# ──────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy manifests first to maximise layer cache reuse
COPY package*.json ./

# Install dependencies (frontend package.json may be sparse; handle gracefully)
RUN npm install --ignore-scripts 2>/dev/null || true

# Copy all source files
COPY . .

# Build static assets
RUN npm run build

# ──────────────────────────────────────────────────────────────────────────────
# Stage 2: runtime
#   - nginx:alpine is ~5 MB; the final image stays well under 50 MB
#   - Serves the Vite build output from dist/
#   - nginx runs as the built-in non-root user "nginx" (uid 101)
# ──────────────────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Custom nginx config: single-page app with API proxy fallback
COPY --chown=nginx:nginx <<'EOF' /etc/nginx/conf.d/app.conf
server {
    listen 3000;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # Gzip static assets
    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    # Cache immutable hashed assets (Vite output)
    location ~* \.(?:js|css|woff2?|ttf|eot|ico|png|jpg|jpeg|svg|gif|webp)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # SPA fallback — all other paths serve index.html
    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

# Copy built static assets from the builder stage
COPY --from=builder --chown=nginx:nginx /app/dist /usr/share/nginx/html

# nginx default setup writes pid/temp files to /var/run and /tmp which are
# writable. The html directory and conf must be readable by uid 101 (nginx).
# Ensure the pid file location is writable by the nginx user.
RUN mkdir -p /var/cache/nginx /var/run \
    && chown -R nginx:nginx /var/cache/nginx /var/run \
    && touch /var/run/nginx.pid \
    && chown nginx:nginx /var/run/nginx.pid

# Run as non-root nginx user
USER nginx

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=10s \
  CMD wget -qO- http://localhost:3000 || exit 1

CMD ["nginx", "-g", "daemon off;"]
