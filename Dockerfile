# Two stages, and the first one only downloads: there is nothing to build.
#
#   docker build -t slipcut-local .
#   docker run --rm -p 8080:80 slipcut-local
FROM alpine:3.22 AS vendor
RUN apk add --no-cache curl
WORKDIR /app
COPY tools/fetch-vendor.sh tools/
# Pinned by version and SHA-256 inside the script, so this layer is reproducible
# and a tampered download fails the build rather than shipping.
RUN sh tools/fetch-vendor.sh

FROM nginx:1.29-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html style.css sw.js manifest.webmanifest /usr/share/nginx/html/
COPY icons/ /usr/share/nginx/html/icons/
COPY config/ /usr/share/nginx/html/config/
COPY src/ /usr/share/nginx/html/src/
COPY --from=vendor /app/vendor/ /usr/share/nginx/html/vendor/

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/index.html >/dev/null || exit 1
