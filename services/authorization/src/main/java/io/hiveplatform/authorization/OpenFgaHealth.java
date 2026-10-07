package io.hiveplatform.authorization;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.stereotype.Component;
@Component("openfga")
class OpenFgaHealth implements HealthIndicator {
  private final URI healthUri;
  private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).followRedirects(HttpClient.Redirect.NEVER).build();
  OpenFgaHealth(@Value("${hive.openfga.url}") URI base) {
    if (!java.util.Set.of("http","https").contains(base.getScheme()) || base.getHost()==null || base.getUserInfo()!=null || base.getQuery()!=null || base.getFragment()!=null) throw new IllegalArgumentException("Invalid OpenFGA origin");
    healthUri=base.resolve("/healthz");
  }
  public Health health() {
    try {
      var response=http.send(HttpRequest.newBuilder(healthUri).timeout(Duration.ofSeconds(3)).GET().build(),HttpResponse.BodyHandlers.discarding());
      return response.statusCode()==200 ? Health.up().build() : Health.down().build();
    } catch (InterruptedException e) { Thread.currentThread().interrupt(); return Health.down().build(); }
      catch (Exception e) { return Health.down().build(); }
  }
}