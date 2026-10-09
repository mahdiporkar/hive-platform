# hive/operator-console — optional control-plane UI. Build first: npm run build:console
FROM nginx:1.29.1-alpine
ARG HIVE_BUILD_COMMIT=unknown
LABEL org.opencontainers.image.title="hive-operator-console" \
      org.opencontainers.image.source="https://github.com/mahdiporkar/hive-platform" \
      org.opencontainers.image.revision="${HIVE_BUILD_COMMIT}"
COPY apps/operator-console/dist/ /usr/share/nginx/html/
COPY infra/nginx/console.conf.template /etc/nginx/templates/default.conf.template
# Served at /console/version.json: deployment smoke tests confirm which build is live.
RUN printf %s "{\"commit\":\"$HIVE_BUILD_COMMIT\"}" > /usr/share/nginx/html/version.json
EXPOSE 8080
