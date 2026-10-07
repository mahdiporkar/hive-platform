package io.hiveplatform.authorization.manifest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.hiveplatform.artifacts.security.UiArtifactUriPolicy;
import io.hiveplatform.spring.HiveException;
import org.junit.jupiter.api.Test;

class ManifestDocumentsTest {
  private static final ObjectMapper JSON = new ObjectMapper();
  private final ManifestDocuments documents = new ManifestDocuments(new UiArtifactUriPolicy("PRODUCTION_INTERNET", false, ""), true);

  private static ObjectNode resources() throws Exception {
    return (ObjectNode) JSON.readTree("""
        {"schemaVersion":"1.0.0","manifestVersion":"1.0.0","applicationKey":"app","moduleKey":"mod",
         "resources":[{"key":"mod","type":"MODULE","parentKey":"app","name":"Module","actions":["view",{"key":"export","description":"Export"}]}]}""");
  }

  private static ObjectNode frontend() throws Exception {
    return (ObjectNode) JSON.readTree("""
        {"schemaVersion":"1.0.0","manifestVersion":"2.1.0","contractVersion":"1.1.0","runtimeVersion":"1.0.0","applicationKey":"app","moduleKey":"mod","displayName":"Module",
         "artifact":{"url":"/modules/mod/entry.js","integrity":"sha384-AAAA","format":"ES_MODULE"},
         "routes":[{"key":"home","path":"/mod","access":"AUTHENTICATED","resource":"mod","action":"view","navigation":{"label":"Module","order":1}},
                   {"key":"about","path":"/mod/about","access":"PUBLIC"}]}""");
  }

  private static String code(Runnable action) {
    try {
      action.run();
      return "OK";
    } catch (HiveException e) {
      return e.code();
    }
  }

  @Test
  void parsesValidManifests() throws Exception {
    var resource = documents.resourceManifest(resources());
    assertThat(resource.resources()).hasSize(1);
    assertThat(resource.resources().getFirst().actions()).extracting("key").containsExactly("view", "export");
    var mf = documents.microFrontendManifest(frontend());
    assertThat(mf.routes()).hasSize(2);
    assertThat(mf.styleIsolation()).isEqualTo("SCOPED");
  }

  @Test
  void checksumIgnoresKeyOrder() throws Exception {
    JsonNode reordered = JSON.readTree("""
        {"resources":[{"actions":["view",{"description":"Export","key":"export"}],"name":"Module","parentKey":"app","type":"MODULE","key":"mod"}],
         "moduleKey":"mod","applicationKey":"app","manifestVersion":"1.0.0","schemaVersion":"1.0.0"}""");
    assertThat(ManifestDocuments.checksum(reordered)).isEqualTo(ManifestDocuments.checksum(resources()));
  }

  @Test
  void contractsStaySeparate() throws Exception {
    var withRoutes = resources();
    withRoutes.putArray("routes");
    assertThat(code(() -> documents.resourceManifest(withRoutes))).isEqualTo("MANIFEST_INVALID");
    var resourceWithUrl = resources();
    ((ObjectNode) resourceWithUrl.path("resources").get(0)).put("url", "/x");
    assertThat(code(() -> documents.resourceManifest(resourceWithUrl))).isEqualTo("MANIFEST_INVALID");
    var withGrants = frontend();
    withGrants.putArray("resources");
    assertThat(code(() -> documents.microFrontendManifest(withGrants))).isEqualTo("MANIFEST_INVALID");
  }

  @Test
  void rejectsUnsafeOrAmbiguousFrontendManifests() throws Exception {
    var publicWithPermission = frontend();
    ((ObjectNode) publicWithPermission.path("routes").get(1)).put("resource", "mod").put("action", "view");
    assertThat(code(() -> documents.microFrontendManifest(publicWithPermission))).isEqualTo("MANIFEST_INVALID");
    var halfPermission = frontend();
    ((ObjectNode) halfPermission.path("routes").get(0)).remove("action");
    assertThat(code(() -> documents.microFrontendManifest(halfPermission))).isEqualTo("MANIFEST_INVALID");
    var noIntegrity = frontend();
    ((ObjectNode) noIntegrity.path("artifact")).remove("integrity");
    assertThat(code(() -> documents.microFrontendManifest(noIntegrity))).isEqualTo("INTEGRITY_REQUIRED");
    var commonJs = frontend();
    ((ObjectNode) commonJs.path("artifact")).put("format", "UMD");
    assertThat(code(() -> documents.microFrontendManifest(commonJs))).isEqualTo("MODULE_FORMAT_UNSUPPORTED");
    var privateHost = frontend();
    ((ObjectNode) privateHost.path("artifact")).put("url", "https://10.1.2.3/entry.js");
    assertThat(code(() -> documents.microFrontendManifest(privateHost))).isEqualTo("ARTIFACT_LOCATION_REJECTED");
    var traversal = frontend();
    ((ObjectNode) traversal.path("artifact")).put("url", "/modules/../secret/entry.js");
    assertThat(code(() -> documents.microFrontendManifest(traversal))).isEqualTo("MANIFEST_INVALID");
    var badPath = frontend();
    ((ObjectNode) badPath.path("routes").get(0)).put("path", "mod/../x");
    assertThat(code(() -> documents.microFrontendManifest(badPath))).isEqualTo("MANIFEST_INVALID");
    for (String dotSegment : new String[] {"/mod/../x", "/mod/./x", "/.."}) {
      var dotted = frontend();
      ((ObjectNode) dotted.path("routes").get(0)).put("path", dotSegment);
      assertThat(code(() -> documents.microFrontendManifest(dotted))).as(dotSegment).isEqualTo("MANIFEST_INVALID");
    }
    var duplicatePath = frontend();
    ((ObjectNode) duplicatePath.path("routes").get(1)).put("path", "/mod");
    assertThat(code(() -> documents.microFrontendManifest(duplicatePath))).isEqualTo("MANIFEST_INVALID");
    var futureContract = frontend();
    futureContract.put("contractVersion", "2.0.0");
    assertThat(code(() -> documents.microFrontendManifest(futureContract))).isEqualTo("VERSION_MAJOR_UNSUPPORTED");
  }

  @Test
  void deprecatedContractIsAcceptedWithWarning() throws Exception {
    var legacy = frontend();
    legacy.put("contractVersion", "1.0.0");
    assertThat(documents.microFrontendManifest(legacy).warnings()).extracting("code").containsExactly("VERSION_DEPRECATED");
  }

  @Test
  void productionPolicyRejectsPlainHttpArtifacts() throws Exception {
    var http = frontend();
    ((ObjectNode) http.path("artifact")).put("url", "http://cdn.example.com/entry.js");
    assertThatThrownBy(() -> documents.microFrontendManifest(http)).isInstanceOf(HiveException.class).hasMessageContaining("HTTPS");
  }
}
