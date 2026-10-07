package io.hiveplatform.spring;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.function.BooleanSupplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Fail-closed startup check. In the {@code production} profile (the default) every registered rule must hold,
 * otherwise the service refuses to start and lists every violation. The {@code development} profile only logs them.
 * Rules never print secret values.
 */
public final class ProductionGuard {
  public record Rule(String description, BooleanSupplier violated) {}

  private static final Logger log = LoggerFactory.getLogger(ProductionGuard.class);
  private final String profile;
  private final List<Rule> rules = new ArrayList<>();

  public ProductionGuard(String profile) {
    String normalized = profile == null || profile.isBlank() ? "production" : profile.trim().toLowerCase(Locale.ROOT);
    if (!List.of("production", "development").contains(normalized)) throw new IllegalArgumentException("HIVE_PROFILE must be production or development");
    this.profile = normalized;
  }

  public ProductionGuard rule(String description, BooleanSupplier violated) {
    rules.add(new Rule(description, violated));
    return this;
  }

  public boolean production() { return "production".equals(profile); }

  /** @throws IllegalStateException in production when any rule is violated */
  public List<String> enforce(String service) {
    List<String> violations = rules.stream().filter(r -> r.violated().getAsBoolean()).map(Rule::description).toList();
    if (violations.isEmpty()) return violations;
    if (production()) throw new IllegalStateException(service + " refuses to start in the production profile: " + String.join("; ", violations)
        + ". Fix the configuration or set HIVE_PROFILE=development for local evaluation only.");
    violations.forEach(v -> log.warn("Development profile allows unsafe setting: {}", v));
    return violations;
  }
}
