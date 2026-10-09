package io.hiveplatform.authorization.manifest;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.hiveplatform.artifacts.security.UiArtifactUriPolicy;
import io.hiveplatform.spring.HiveException;
import org.junit.jupiter.api.Test;

/** Module Federation artifact descriptors, entry format detection, address composition and browser URL rewriting. */
class FederationFormatsTest {
  private static final ObjectMapper JSON = new ObjectMapper();
  private final ManifestDocuments documents = new ManifestDocuments(new UiArtifactUriPolicy("UNRESTRICTED", true, ""), true);

  private static ObjectNode manifest(String artifact) throws Exception {
    return (ObjectNode) JSON.readTree("""
        {"schemaVersion":"1.0.0","manifestVersion":"1.0.0","contractVersion":"1.1.0","runtimeVersion":"1.0.0","applicationKey":"app","moduleKey":"reports",
         "displayName":"Reports","artifact":%s,"routes":[{"key":"home","path":"/reports","access":"PUBLIC"}]}""".formatted(artifact));
  }

  private String code(String artifact) {
    try {
      documents.microFrontendManifest(manifest(artifact));
      return "OK";
    } catch (HiveException e) {
      return e.code() + ": " + e.getMessage();
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  @Test
  void federationFormatsRequireTheirContainerDescriptor() {
    String sri = "\"integrity\":\"sha384-AAAA\"";
    assertThat(code("{\"url\":\"http://10.0.0.15:3004/remoteEntry.js\"," + sri + ",\"format\":\"WEBPACK_FEDERATION\",\"remoteName\":\"reports\",\"exposedModule\":\"./plugin\"}")).isEqualTo("OK");
    assertThat(code("{\"url\":\"http://10.0.0.15:3004/remoteEntry.js\"," + sri + ",\"format\":\"VITE_FEDERATION\",\"exposedModule\":\"./plugin\"}")).isEqualTo("OK");
    assertThat(code("{\"url\":\"http://10.0.0.15:3004/remoteEntry.js\"," + sri + ",\"format\":\"WEBPACK_FEDERATION\",\"exposedModule\":\"./plugin\"}")).contains("remoteName");
    assertThat(code("{\"url\":\"http://10.0.0.15:3004/remoteEntry.js\"," + sri + ",\"format\":\"VITE_FEDERATION\"}")).contains("exposedModule");
    assertThat(code("{\"url\":\"http://10.0.0.15:3004/remoteEntry.js\"," + sri + ",\"format\":\"VITE_FEDERATION\",\"exposedModule\":\"./../x\"}")).contains("exposedModule");
    assertThat(code("{\"url\":\"/modules/r/entry.js\"," + sri + ",\"format\":\"ES_MODULE\",\"remoteName\":\"x\"}")).contains("only to Module Federation");
    assertThat(code("{\"url\":\"/modules/r/entry.js\"," + sri + ",\"format\":\"SYSTEMJS\"}")).startsWith("MODULE_FORMAT_UNSUPPORTED");
  }

  @Test
  void detectsEntryFormats() {
    var webpack = ArtifactInspector.detect("var reports_remote;\n(()=>{var __webpack_require__={};var moduleMap={\"./plugin\":()=>Promise.resolve()};reports_remote={get,init}})();");
    assertThat(webpack.format()).isEqualTo("WEBPACK_FEDERATION");
    assertThat(webpack.remoteName()).isEqualTo("reports_remote");
    assertThat(webpack.exposed()).containsExactly("./plugin");
    var vite = ArtifactInspector.detect("const moduleMap={'./plugin':()=>import('./x.js')};const get=m=>moduleMap[m]();const init=s=>{};export { get, init };");
    assertThat(vite.format()).isEqualTo("VITE_FEDERATION");
    assertThat(vite.exposed()).containsExactly("./plugin");
    assertThat(ArtifactInspector.detect("export default {contractVersion:'1.1.0',create(){}};").format()).isEqualTo("ES_MODULE");
    assertThat(ArtifactInspector.detect("const app={};export { app as default };").format()).isEqualTo("ES_MODULE");
    assertThat(ArtifactInspector.detect("console.log('hello');").format()).isNull();
  }

  @Test
  void composesAddressesFromHostAndPort() {
    assertThat(ArtifactInspector.compose(new ArtifactInspector.ProbeRequest(null, "HTTP", "10.0.0.15", 3004, "/remoteEntry.js", null, null, null, null, null)))
        .isEqualTo("http://10.0.0.15:3004/remoteEntry.js");
    assertThat(ArtifactInspector.compose(new ArtifactInspector.ProbeRequest(null, "https", "mfe.internal", null, "entry.js", "reports", null, null, null, null)))
        .isEqualTo("https://mfe.internal/reports/entry.js");
    assertThat(ArtifactInspector.compose(new ArtifactInspector.ProbeRequest("http://10.0.0.15:3004/remoteEntry.js", null, null, null, null, null, null, null, null, null)))
        .isEqualTo("http://10.0.0.15:3004/remoteEntry.js");
  }

  @Test
  void browsersSeeOnlyTheGatewayPathOfUpstreamArtifacts() {
    assertThat(RuntimeCatalog.browserUrl("reports", "1.2.0", "http://10.0.0.15:3004/app/remoteEntry.js")).isEqualTo("/api/mfe/reports/1.2.0/remoteEntry.js");
    assertThat(RuntimeCatalog.browserUrl("reports", "1.2.0", "/modules/reports/entry.js")).isEqualTo("/modules/reports/entry.js");
  }
}
