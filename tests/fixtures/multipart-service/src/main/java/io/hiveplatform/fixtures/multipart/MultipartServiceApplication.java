package io.hiveplatform.fixtures.multipart;

import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * An ordinary downstream Spring Boot service, written the way any Hive consumer would write it: standard
 * {@code @RequestPart MultipartFile} uploads, {@code @RequestParam} forms, JSON and raw bodies. Every endpoint reports
 * exactly what Spring parsed (names, filenames, content types, SHA-256 of the bytes, text values) and which headers
 * arrived, so tests can prove what Hive's RuntimeProxy forwarded.
 */
@SpringBootApplication
@RestController
public class MultipartServiceApplication {
  public static void main(String[] args) { SpringApplication.run(MultipartServiceApplication.class, args); }

  @org.springframework.web.bind.annotation.GetMapping("/health")
  public Map<String, String> health() { return Map.of("status", "UP"); }

  public record FilePart(String name, String filename, String contentType, long size, String sha256) {}

  @PostMapping(path = "/uploads", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public Map<String, Object> upload(@RequestPart("file") List<MultipartFile> files, @RequestParam MultiValueMap<String, String> fields,
                                    @RequestHeader HttpHeaders headers) throws IOException {
    List<FilePart> parts = new ArrayList<>();
    for (MultipartFile file : files) parts.add(new FilePart(file.getName(), file.getOriginalFilename(), file.getContentType(), file.getSize(), sha256(file.getBytes())));
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("kind", "multipart");
    result.put("files", parts);
    result.put("fields", fields.toSingleValueMap());
    result.put("headers", visible(headers));
    return result;
  }

  @PostMapping(path = "/forms", consumes = MediaType.APPLICATION_FORM_URLENCODED_VALUE)
  public Map<String, Object> formPost(@RequestParam MultiValueMap<String, String> fields, @RequestHeader HttpHeaders headers) {
    return Map.of("kind", "form", "fields", fields.toSingleValueMap(), "headers", visible(headers));
  }

  @PutMapping(path = "/forms", consumes = MediaType.APPLICATION_FORM_URLENCODED_VALUE)
  public Map<String, Object> formPut(@RequestParam MultiValueMap<String, String> fields, @RequestHeader HttpHeaders headers) {
    return Map.of("kind", "form", "fields", fields.toSingleValueMap(), "headers", visible(headers));
  }

  @PostMapping(path = "/json", consumes = MediaType.APPLICATION_JSON_VALUE)
  public Map<String, Object> json(@RequestBody Map<String, Object> body, @RequestHeader HttpHeaders headers) {
    return Map.of("kind", "json", "body", body, "headers", visible(headers));
  }

  @PostMapping(path = "/raw", consumes = MediaType.APPLICATION_OCTET_STREAM_VALUE)
  public Map<String, Object> raw(@RequestBody byte[] body, @RequestHeader HttpHeaders headers) {
    return Map.of("kind", "raw", "size", body.length, "sha256", sha256(body), "headers", visible(headers));
  }

  /** Token endpoint for Hive LEGACY routes targeting this service (fixed test credential only). */
  @PostMapping(path = "/legacy/oauth/token", consumes = MediaType.APPLICATION_JSON_VALUE)
  public org.springframework.http.ResponseEntity<Map<String, Object>> legacyToken(@RequestBody Map<String, Object> credential) {
    if (!"svc-account".equals(credential.get("username")) || !"svc-password".equals(credential.get("password"))) {
      return org.springframework.http.ResponseEntity.status(401).body(Map.of("error", "invalid_client"));
    }
    return org.springframework.http.ResponseEntity.ok(Map.of("data", Map.of("accessToken", "legacy-" + java.util.UUID.randomUUID(), "expiresIn", 300, "type", "Bearer")));
  }

  /** Header names and values as received, except the credential itself (only whether one arrived and its scheme). */
  private static Map<String, String> visible(HttpHeaders headers) {
    Map<String, String> out = new TreeMap<>();
    headers.forEach((name, values) -> {
      String key = name.toLowerCase();
      out.put(key, key.equals("authorization") ? values.get(0).split(" ")[0] + " <present>" : String.join(",", values));
    });
    return out;
  }

  private static String sha256(byte[] bytes) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }
}
