package io.hiveplatform.authorization.graph;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Resolves the deployment's OpenFGA store and installs the reviewed authorization model.
 * The store is discovered or created under a PostgreSQL advisory lock so that concurrent instances converge on one store.
 * Initialization is retried lazily; until it succeeds every decision fails closed.
 */
@Component
public class GraphStore {
  public record Coordinates(String storeId, String modelId) {}

  private static final Logger log = LoggerFactory.getLogger(GraphStore.class);
  private final OpenFgaClient client;
  private final JdbcClient db;
  private final TransactionTemplate tx;
  private final String storeName;
  private final String configuredStoreId;
  private final JsonNode model;
  private volatile Coordinates coordinates;
  private volatile boolean freshStore;

  public GraphStore(OpenFgaClient client, JdbcClient db, TransactionTemplate tx, ObjectMapper json,
      @Value("${hive.openfga.store-name:hive}") String storeName, @Value("${hive.openfga.store-id:}") String configuredStoreId) throws IOException {
    this.client = client;
    this.db = db;
    this.tx = tx;
    this.storeName = storeName;
    this.configuredStoreId = configuredStoreId;
    try (InputStream in = GraphStore.class.getResourceAsStream("/openfga/model.json")) {
      if (in == null) throw new IllegalStateException("Packaged authorization model missing");
      this.model = json.readTree(in);
    }
  }

  public Coordinates coordinates() {
    Coordinates current = coordinates;
    if (current != null) return current;
    synchronized (this) {
      if (coordinates == null) coordinates = initialize();
      return coordinates;
    }
  }

  /** Forgets cached coordinates, e.g. after the graph store was found missing. */
  public synchronized void reset() { coordinates = null; }

  /** A 404 from OpenFGA means the store or model vanished; forget coordinates so the next use re-resolves and replays. */
  public void invalidateIfMissing(OpenFgaClient.GraphUnavailable failure) {
    if (failure.getMessage() != null && (failure.getMessage().contains("HTTP 404") || failure.getMessage().contains("store_id_not_found") || failure.getMessage().contains("authorization_model_not_found"))) reset();
  }

  /**
   * OpenFGA soft-deletes stores: checks against a deleted store id keep answering from stale data. Verify the store
   * still exists and re-resolve (creating and replaying a new store) when it does not.
   */
  public void verify() {
    Coordinates current = coordinates;
    if (current != null && !client.storeExists(current.storeId())) reset();
  }

  /** True once after this instance created an empty store; the caller must replay relational state. */
  public synchronized boolean consumeFreshStore() {
    boolean fresh = freshStore;
    freshStore = false;
    return fresh;
  }

  private Coordinates initialize() {
    String storeId = configuredStoreId.isBlank() ? resolveStore() : configuredStoreId;
    String modelId = client.writeModel(storeId, model);
    log.info("Authorization graph ready: store={} model={}", storeId, modelId);
    return new Coordinates(storeId, modelId);
  }

  private String resolveStore() {
    return tx.execute(status -> {
      db.sql("select pg_advisory_xact_lock(hashtextextended('hive.graph-store', 0))").query().singleValue();
      var known = db.sql("select store_id from graph_store where store_name = ?").param(storeName).query(String.class).optional();
      if (known.isPresent() && client.storeExists(known.get())) return known.get();
      String found = client.findStore(storeName);
      String id = found != null ? found : client.createStore(storeName);
      db.sql("insert into graph_store(store_name, store_id) values (?, ?) on conflict (store_name) do update set store_id = excluded.store_id")
          .params(storeName, id).update();
      if (found == null) {
        // A new, empty store: the relational source of truth must be replayed into it.
        freshStore = true;
        if (known.isPresent()) log.warn("Authorization graph store {} was missing; replaying relational state", known.get());
      }
      return id;
    });
  }
}
