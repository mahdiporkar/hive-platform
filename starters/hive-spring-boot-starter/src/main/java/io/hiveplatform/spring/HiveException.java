package io.hiveplatform.spring;

import org.springframework.http.HttpStatus;

/** A failure whose code and message are safe to return to API clients. */
public class HiveException extends RuntimeException {
  private final HttpStatus status;
  private final String code;

  public HiveException(HttpStatus status, String code, String message) {
    super(message);
    this.status = status;
    this.code = code;
  }

  public HttpStatus status() { return status; }
  public String code() { return code; }

  public static HiveException invalid(String message) { return new HiveException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", message); }
  public static HiveException notFound(String message) { return new HiveException(HttpStatus.NOT_FOUND, "NOT_FOUND", message); }
  public static HiveException conflict(String message) { return new HiveException(HttpStatus.CONFLICT, "CONFLICT", message); }
  public static HiveException stale() { return new HiveException(HttpStatus.CONFLICT, "REVISION_CONFLICT", "The record changed concurrently; reload and retry"); }
  public static HiveException forbidden(String message) { return new HiveException(HttpStatus.FORBIDDEN, "ACCESS_DENIED", message); }
}
