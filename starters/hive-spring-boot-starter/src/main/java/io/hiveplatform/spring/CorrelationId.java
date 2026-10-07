package io.hiveplatform.spring;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import java.util.regex.Pattern;
import org.slf4j.MDC;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Accepts a well-formed inbound {@code X-Correlation-Id} or creates one, exposes it to logs (MDC),
 * to downstream calls ({@link #current()}) and echoes it on the response.
 */
public final class CorrelationId extends OncePerRequestFilter {
  public static final String HEADER = "X-Correlation-Id";
  public static final String MDC_KEY = "correlationId";
  private static final Pattern SAFE = Pattern.compile("[A-Za-z0-9._:-]{8,128}");

  public static String current() {
    String value = MDC.get(MDC_KEY);
    return value == null ? UUID.randomUUID().toString() : value;
  }

  public static String sanitize(String candidate) {
    return candidate != null && SAFE.matcher(candidate).matches() ? candidate : UUID.randomUUID().toString();
  }

  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    String id = sanitize(request.getHeader(HEADER));
    MDC.put(MDC_KEY, id);
    response.setHeader(HEADER, id);
    try {
      chain.doFilter(request, response);
    } finally {
      MDC.remove(MDC_KEY);
    }
  }
}
