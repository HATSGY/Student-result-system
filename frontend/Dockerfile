FROM nginx:1.27-alpine

# API Gateway invoke URL baked into script.js at build time:
#   docker build --build-arg API_BASE_URL=https://xxxx.execute-api.<region>.amazonaws.com .
ARG API_BASE_URL=""

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY . /usr/share/nginx/html/
RUN rm -f /usr/share/nginx/html/Dockerfile /usr/share/nginx/html/nginx.conf /usr/share/nginx/html/.dockerignore \
 && if [ -n "$API_BASE_URL" ]; then \
      sed -i "s|^const API_BASE_URL = .*|const API_BASE_URL = \"${API_BASE_URL}\";|" /usr/share/nginx/html/script.js; \
    fi

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
