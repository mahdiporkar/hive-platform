package io.hiveplatform.bff.security;
import org.junit.jupiter.api.Test;
import java.util.Base64;
import static org.assertj.core.api.Assertions.*;
class TokenVaultCryptoTest {
 private static String key(int fill){byte[] bytes=new byte[32];java.util.Arrays.fill(bytes,(byte)fill);return Base64.getEncoder().encodeToString(bytes);}
 @Test void randomNonceAndRoundTrip(){var crypto=new TokenVaultCrypto("current",key(1));var a=crypto.encrypt("private-value");assertThat(a).isNotEqualTo(crypto.encrypt("private-value")).doesNotContain("private-value");assertThat(crypto.decrypt(a)).isEqualTo("private-value");}
 @Test void rotatesWithoutLosingOldRecords(){var old=new TokenVaultCrypto("old",key(1));var current=new TokenVaultCrypto("new",key(2),"old="+key(1));assertThat(current.decrypt(old.encrypt("value"))).isEqualTo("value");assertThat(current.encrypt("value")).startsWith("new.");}
 @Test void rejectsTamperingAndUnknownKey(){var crypto=new TokenVaultCrypto("current",key(1));var parts=crypto.encrypt("value").split("\\.");byte[] cipher=Base64.getUrlDecoder().decode(parts[2]);cipher[0]^=1;assertThatThrownBy(()->crypto.decrypt(parts[0]+"."+parts[1]+"."+Base64.getUrlEncoder().withoutPadding().encodeToString(cipher))).isInstanceOf(IllegalStateException.class);assertThatThrownBy(()->crypto.decrypt("missing."+parts[1]+"."+parts[2])).isInstanceOf(IllegalStateException.class);}
 @Test void rejectsInvalidKeysAndDuplicateIds(){assertThatThrownBy(()->new TokenVaultCrypto("bad.id",key(1))).isInstanceOf(IllegalArgumentException.class);assertThatThrownBy(()->new TokenVaultCrypto("key","short")).isInstanceOf(IllegalArgumentException.class);assertThatThrownBy(()->new TokenVaultCrypto("key",key(1),"key="+key(2))).isInstanceOf(IllegalArgumentException.class);}
}