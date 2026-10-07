package io.hiveplatform.spring;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class RedactionTest {
  @Test
  void masksSensitiveKeysRecursively() {
    var input = Map.of("user", "u1", "password", "p-value", "nested",
        Map.of("client_secret", "s-value", "items", List.of(Map.of("accessToken", "t-value"))));
    String rendered = String.valueOf(Redaction.value(input));
    assertThat(rendered).doesNotContain("p-value", "s-value", "t-value").contains("user=u1");
  }

  @Test
  void masksTokenShapedText() {
    String jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl";
    assertThat(Redaction.text("Authorization: Bearer abc.def-123")).doesNotContain("abc.def-123");
    assertThat(Redaction.text("token " + jwt)).doesNotContain(jwt);
    assertThat(Redaction.text("Basic dXNlcjpwYXNzd29yZA==")).doesNotContain("dXNlcjpwYXNzd29yZA==");
  }

  @Test
  void correlationIdRejectsInjection() {
    assertThat(CorrelationId.sanitize("good-id-1234")).isEqualTo("good-id-1234");
    assertThat(CorrelationId.sanitize("bad\nid-value")).isNotEqualTo("bad\nid-value").hasSize(36);
    assertThat(CorrelationId.sanitize(null)).hasSize(36);
  }
}
