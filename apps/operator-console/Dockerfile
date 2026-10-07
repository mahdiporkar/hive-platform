# hive/operator-console — optional control-plane UI. Build first: npm run build:console
FROM nginx:1.29.1-alpine
COPY apps/operator-console/dist/ /usr/share/nginx/html/
COPY infra/nginx/console.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 8080
