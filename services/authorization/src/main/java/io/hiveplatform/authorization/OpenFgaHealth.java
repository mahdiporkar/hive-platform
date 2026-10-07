package io.hiveplatform.authorization;

import io.hiveplatform.authorization.graph.GraphStore;
import io.hiveplatform.authorization.graph.OpenFgaClient;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.stereotype.Component;

/** Ready only when OpenFGA answers and the deployment store and model are installed. */
@Component("openfga")
class OpenFgaHealth implements HealthIndicator {
  private final OpenFgaClient client;
  private final GraphStore store;

  OpenFgaHealth(OpenFgaClient client, GraphStore store) {
    this.client = client;
    this.store = store;
  }

  public Health health() {
    if (!client.healthy()) return Health.down().build();
    try {
      store.coordinates();
      return Health.up().build();
    } catch (RuntimeException notReady) {
      store.reset();
      return Health.down().build();
    }
  }
}
