# Runtime image for the Hive authorization service. Build the jar first: ./mvnw -B package
FROM eclipse-temurin:21.0.8_9-jre-alpine
RUN addgroup -S hive && adduser -S -G hive -H hive
WORKDIR /app
COPY target/authorization-0.1.0-SNAPSHOT.jar /app/app.jar
USER hive
EXPOSE 8082
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=12 CMD wget -qO- http://127.0.0.1:8082/actuator/health/readiness >/dev/null || exit 1
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-Djava.security.egd=file:/dev/urandom", "-jar", "/app/app.jar"]
