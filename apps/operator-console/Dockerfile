# hive/operator-console — optional control-plane UI. Build first: npm run build:console
FROM nginx:1.29.1-alpine
COPY apps/operator-console/dist/ /usr/share/nginx/html/
COPY infra/nginx/console.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=12 CMD wget -qO- http://127.0.0.1:8080/console/index.html >/dev/null || exit 1
