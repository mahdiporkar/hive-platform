package io.hiveplatform.authorization.graph;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Minimal OpenFGA HTTP API client. Every failure is surfaced as {@link GraphUnavailable}. */
public final class OpenFgaClient {
  public record Tuple(String user, String relation, String object) {
    public Tuple {
      if (blank(user) || blank(relation) || blank(object)) throw new IllegalArgumentException("Incomplete relationship tuple");
    }
    private static boolean blank(String value) { return value == null || value.isBlank(); }
  }

  public static final class GraphUnavailable extends RuntimeException {
    public GraphUnavailable(String message) { super(message); }
  }

  private static final int BATCH_LIMIT = 50;
  private final URI base;
  private final String apiToken;
  private final ObjectMapper json;
  private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2))
      .followRedirects(HttpClient.Redirect.NEVER).build();

  public OpenFgaClient(URI base, String apiToken, ObjectMapper json) {
    if (!Set.of("http", "https").contains(base.getScheme()) || base.getHost() == null || base.getUserInfo() != null
        || base.getQuery() != null || base.getFragment() != null) throw new IllegalArgumentException("Invalid OpenFGA origin");
    this.base = base;
    this.apiToken = apiToken == null ? "" : apiToken;
    this.json = json;
  }

  public String findStore(String name) {
    String token = "";
    for (int page = 0; page < 100; page++) {
      JsonNode result = call("GET", "/stores?page_size=100" + (token.isEmpty() ? "" : "&continuation_token=" + URLEncoder.encode(token, StandardCharsets.UTF_8)), null);
      for (JsonNode store : result.path("stores")) if (name.equals(store.path("name").asText())) return store.path("id").asText();
      token = result.path("continuation_token").asText("");
      if (token.isEmpty()) return null;
    }
    return null;
  }

  public String createStore(String name) {
    return call("POST", "/stores", json.createObjectNode().put("name", name)).path("id").asText();
  }

  public boolean storeExists(String storeId) {
    try {
      call("GET", "/stores/" + storeId, null);
      return true;
    } catch (GraphUnavailable missing) {
      if (missing.getMessage().contains("HTTP 404")) return false;
      throw missing;
    }
  }

  public String writeModel(String storeId, JsonNode model) {
    return call("POST", "/stores/" + storeId + "/authorization-models", model).path("authorization_model_id").asText();
  }

  /** Idempotent write/delete: duplicates and missing tuples are ignored, matching the at-least-once outbox. */
  public void write(String storeId, String modelId, List<Tuple> writes, List<Tuple> deletes) {
    ObjectNode body = json.createObjectNode().put("authorization_model_id", modelId);
    if (!writes.isEmpty()) {
      ObjectNode node = body.putObject("writes");
      node.put("on_duplicate", "ignore");
      writes.forEach(t -> tuple(node.withArray("tuple_keys"), t));
    }
    if (!deletes.isEmpty()) {
      ObjectNode node = body.putObject("deletes");
      node.put("on_missing", "ignore");
      deletes.forEach(t -> tuple(node.withArray("tuple_keys"), t));
    }
    call("POST", "/stores/" + storeId + "/write", body);
  }

  public boolean check(String storeId, String modelId, Tuple tuple) {
    ObjectNode body = json.createObjectNode().put("authorization_model_id", modelId).put("consistency", "HIGHER_CONSISTENCY");
    ObjectNode key = body.putObject("tuple_key");
    key.put("user", tuple.user()).put("relation", tuple.relation()).put("object", tuple.object());
    return call("POST", "/stores/" + storeId + "/check", body).path("allowed").asBoolean(false);
  }

  /** Returns a decision per tuple; per-item errors are treated as denials by the caller. */
  public Map<Tuple, Boolean> batchCheck(String storeId, String modelId, List<Tuple> tuples) {
    Map<Tuple, Boolean> decisions = new HashMap<>();
    for (int start = 0; start < tuples.size(); start += BATCH_LIMIT) {
      List<Tuple> chunk = tuples.subList(start, Math.min(tuples.size(), start + BATCH_LIMIT));
      ObjectNode body = json.createObjectNode().put("authorization_model_id", modelId).put("consistency", "HIGHER_CONSISTENCY");
      ArrayNode checks = body.putArray("checks");
      Map<String, Tuple> correlation = new HashMap<>();
      for (int i = 0; i < chunk.size(); i++) {
        Tuple tuple = chunk.get(i);
        String id = "c" + i;
        correlation.put(id, tuple);
        ObjectNode check = checks.addObject();
        check.put("correlation_id", id);
        check.putObject("tuple_key").put("user", tuple.user()).put("relation", tuple.relation()).put("object", tuple.object());
      }
      JsonNode result = call("POST", "/stores/" + storeId + "/batch-check", body).path("result");
      correlation.forEach((id, tuple) -> {
        JsonNode item = result.path(id);
        decisions.put(tuple, item.path("error").isMissingNode() && item.path("allowed").asBoolean(false));
      });
    }
    return decisions;
  }

  public boolean healthy() {
    try {
      var response = http.send(HttpRequest.newBuilder(base.resolve("/healthz")).timeout(Duration.ofSeconds(3)).GET().build(),
          HttpResponse.BodyHandlers.discarding());
      return response.statusCode() == 200;
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return false;
    } catch (IOException e) {
      return false;
    }
  }

  private static void tuple(ArrayNode keys, Tuple tuple) {
    keys.addObject().put("user", tuple.user()).put("relation", tuple.relation()).put("object", tuple.object());
  }

  private JsonNode call(String method, String path, JsonNode body) {
    try {
      var builder = HttpRequest.newBuilder(base.resolve(path)).timeout(Duration.ofSeconds(5)).header("Accept", "application/json");
      if (!apiToken.isEmpty()) builder.header("Authorization", "Bearer " + apiToken);
      if (body == null) builder.method(method, HttpRequest.BodyPublishers.noBody());
      else builder.header("Content-Type", "application/json").method(method, HttpRequest.BodyPublishers.ofByteArray(json.writeValueAsBytes(body)));
      var response = http.send(builder.build(), HttpResponse.BodyHandlers.ofByteArray());
      if (response.statusCode() / 100 != 2) {
        String detail = new String(response.body(), StandardCharsets.UTF_8);
        throw new GraphUnavailable("OpenFGA HTTP " + response.statusCode() + " " + (detail.length() > 300 ? detail.substring(0, 300) : detail));
      }
      return response.body().length == 0 ? json.createObjectNode() : json.readTree(response.body());
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new GraphUnavailable("OpenFGA call interrupted");
    } catch (IOException e) {
      throw new GraphUnavailable("OpenFGA unreachable: " + e.getClass().getSimpleName());
    }
  }
}
