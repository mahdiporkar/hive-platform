# hive/default-shell — optional reference shell and gateway. Build first: npm run build:shell
FROM nginx:1.29.1-alpine
COPY apps/default-shell/dist/ /usr/share/nginx/html/
COPY infra/nginx/hive-gateway.conf.template /etc/nginx/templates/default.conf.template
RUN mkdir -p /srv/hive/modules
ENV HIVE_BFF_UPSTREAM=http://bff:8081 HIVE_CONSOLE_UPSTREAM=http://operator-console:8080
EXPOSE 8080
