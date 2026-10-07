package io.hiveplatform.spring;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class ProductionGuardTest {
  @Test
  void productionIsTheDefaultAndFailsClosedListingEveryViolation() {
    var guard = new ProductionGuard(null).rule("first unsafe", () -> true).rule("safe", () -> false).rule("second unsafe", () -> true);
    assertThat(guard.production()).isTrue();
    assertThatThrownBy(() -> guard.enforce("svc")).isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("first unsafe; second unsafe").hasMessageContaining("HIVE_PROFILE=development");
  }

  @Test
  void developmentOnlyReports() {
    assertThat(new ProductionGuard("development").rule("unsafe", () -> true).enforce("svc")).containsExactly("unsafe");
  }

  @Test
  void cleanProductionPasses() {
    assertThat(new ProductionGuard("PRODUCTION").rule("unsafe", () -> false).enforce("svc")).isEmpty();
  }

  @Test
  void unknownProfilesAreRejected() {
    assertThatThrownBy(() -> new ProductionGuard("staging")).isInstanceOf(IllegalArgumentException.class);
  }
}
