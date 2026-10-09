package io.hiveplatform.bff.mfe;

import io.hiveplatform.bff.security.SessionIdentity;
import jakarta.servlet.http.HttpServletRequest;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/** Same-origin delivery of registered micro-frontend artifacts; see {@link ArtifactGateway} for the trust model. */
@RestController
class ArtifactGatewayController {
  static final String PREFIX = "/api/mfe/";
  private final ArtifactGateway gateway;

  ArtifactGatewayController(ArtifactGateway gateway) { this.gateway = gateway; }

  @GetMapping(PREFIX + "{moduleKey}/{version}/**")
  ResponseEntity<byte[]> asset(@PathVariable String moduleKey, @PathVariable String version, HttpServletRequest request) {
    String uri = request.getRequestURI();
    String prefix = PREFIX + moduleKey + "/" + version + "/";
    String assetPath = uri.startsWith(prefix) ? uri.substring(prefix.length()) : "";
    var asset = gateway.serve(moduleKey, version, assetPath, userId());
    var headers = ResponseEntity.status(HttpStatus.OK).cacheControl(CacheControl.noCache().cachePrivate()).eTag(asset.etag())
        .header("X-Content-Type-Options", "nosniff").header("Cross-Origin-Resource-Policy", "same-origin")
        // Applies only if a gateway URL is opened as a document: never a same-origin page of the shell.
        .header("Content-Security-Policy", "default-src 'none'; sandbox");
    if (asset.etag().equals(request.getHeader("If-None-Match"))) return ResponseEntity.status(HttpStatus.NOT_MODIFIED).eTag(asset.etag()).build();
    return headers.contentType(MediaType.parseMediaType(asset.contentType())).body(asset.body());
  }

  private static UUID userId() {
    var authentication = SecurityContextHolder.getContext().getAuthentication();
    return authentication != null && authentication.getPrincipal() instanceof SessionIdentity identity ? UUID.fromString(identity.id()) : null;
  }
}
