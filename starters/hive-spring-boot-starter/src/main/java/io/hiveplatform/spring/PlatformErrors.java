package io.hiveplatform.spring;

import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * Serializes failures as the {@code PlatformError} contract: {@code {code, message, correlationId}}.
 * Unexpected failures never expose exception text. Lowest precedence so feature-specific advice wins.
 */
@RestControllerAdvice
@Order(Ordered.LOWEST_PRECEDENCE)
public class PlatformErrors {
  private static final Logger log = LoggerFactory.getLogger(PlatformErrors.class);

  public static ResponseEntity<Map<String, Object>> body(HttpStatus status, String code, String message) {
    var body = new LinkedHashMap<String, Object>();
    body.put("code", code);
    body.put("message", message);
    body.put("correlationId", CorrelationId.current());
    return ResponseEntity.status(status).body(body);
  }

  @ExceptionHandler(HiveException.class)
  ResponseEntity<Map<String, Object>> hive(HiveException error) {
    return body(error.status(), error.code(), error.getMessage());
  }

  @ExceptionHandler({HttpMessageNotReadableException.class, MethodArgumentTypeMismatchException.class, MissingServletRequestParameterException.class})
  ResponseEntity<Map<String, Object>> unreadable(Exception error) {
    return body(HttpStatus.BAD_REQUEST, "REQUEST_INVALID", "Request body or parameters are malformed");
  }

  @ExceptionHandler(IllegalArgumentException.class)
  ResponseEntity<Map<String, Object>> invalid(IllegalArgumentException error) {
    return body(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", Redaction.safeMessage(error.getMessage()));
  }

  @ExceptionHandler(DataIntegrityViolationException.class)
  ResponseEntity<Map<String, Object>> integrity(DataIntegrityViolationException error) {
    return body(HttpStatus.CONFLICT, "CONFLICT", "The change conflicts with existing data");
  }

  @ExceptionHandler(OptimisticLockingFailureException.class)
  ResponseEntity<Map<String, Object>> stale(OptimisticLockingFailureException error) {
    return body(HttpStatus.CONFLICT, "REVISION_CONFLICT", "The record changed concurrently; reload and retry");
  }

  @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
  ResponseEntity<Map<String, Object>> method(HttpRequestMethodNotSupportedException error) {
    return body(HttpStatus.METHOD_NOT_ALLOWED, "METHOD_NOT_ALLOWED", "HTTP method not supported");
  }

  @ExceptionHandler(NoResourceFoundException.class)
  ResponseEntity<Map<String, Object>> missing(NoResourceFoundException error) {
    return body(HttpStatus.NOT_FOUND, "NOT_FOUND", "Not found");
  }

  @ExceptionHandler(Exception.class)
  ResponseEntity<Map<String, Object>> unexpected(Exception error) {
    log.error("Unhandled request failure", error);
    return body(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Unexpected failure; quote the correlation id");
  }
}
