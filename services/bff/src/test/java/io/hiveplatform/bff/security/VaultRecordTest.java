package io.hiveplatform.bff.security;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;
class VaultRecordTest {
 @Test void refreshNeverExtendsSessionOrInventsLifetime(){var now=Instant.parse("2026-01-01T00:00:00Z");var record=new VaultRecord("provider","access","refresh",now.plusSeconds(10),now.plusSeconds(60));var next=record.refreshed("new-access",null,now.plusSeconds(2),now);assertThat(next.accessExpiresAt()).isEqualTo(now.plusSeconds(2));assertThat(next.sessionExpiresAt()).isEqualTo(record.sessionExpiresAt());assertThat(next.refreshToken()).isEqualTo("refresh");assertThat(next.toString()).doesNotContain("new-access","refresh");}
 @Test void rejectsExpiredSessionAndRefresh(){var now=Instant.now();var record=new VaultRecord("provider","access","refresh",now,now.plusSeconds(20));assertThatThrownBy(()->record.refreshed("new",null,now,now)).isInstanceOf(IllegalArgumentException.class);assertThatThrownBy(()->record.refreshed("new",null,now.plusSeconds(90),now.plusSeconds(30))).isInstanceOf(IllegalArgumentException.class);}
}