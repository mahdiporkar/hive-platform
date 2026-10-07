package io.hiveplatform.authorization.manifest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.hiveplatform.spring.HiveException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/** Runs the shared compatibility matrix (also executed by tests/contracts/compatibility.test.mjs). */
class CompatibilityMatrixTest {
  private static final ObjectMapper JSON = new ObjectMapper();

  static Stream<JsonNode> cases() throws Exception {
    JsonNode root = JSON.readTree(Files.readString(Path.of("../../tests/contracts/compatibility-cases.json")));
    return Stream.iterate(0, i -> i < root.path("cases").size(), i -> i + 1).map(i -> root.path("cases").get(i));
  }

  @ParameterizedTest(name = "{0}")
  @MethodSource("cases")
  @SuppressWarnings("unchecked")
  void sharedCase(JsonNode testCase) {
    Map<String, Object> descriptor = JSON.convertValue(testCase.path("descriptor"), Map.class);
    String expect = testCase.path("expect").asText();
    if ("ok".equals(expect)) {
      var warnings = Compatibility.check(descriptor).stream().map(Compatibility.Diagnostic::code).toList();
      assertThat(warnings).containsExactlyElementsOf(JSON.convertValue(testCase.path("warnings"), java.util.List.class));
    } else {
      assertThatThrownBy(() -> Compatibility.check(descriptor)).isInstanceOfSatisfying(HiveException.class, error -> {
        assertThat(error.code()).isEqualTo(expect);
        assertThat(error.getMessage()).contains(testCase.path("field").asText());
      });
    }
  }
}
