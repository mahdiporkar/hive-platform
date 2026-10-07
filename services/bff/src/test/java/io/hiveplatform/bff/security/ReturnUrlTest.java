package io.hiveplatform.bff.security;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;
class ReturnUrlTest {
 @Test void acceptsOnlyLocalNavigation(){assertThat(ReturnUrl.validate(null)).isEqualTo("/");assertThat(ReturnUrl.validate("/news/123?view=compact")).isEqualTo("/news/123?view=compact");assertThat(ReturnUrl.validate("/search?q=%D8%B3")).startsWith("/search");}
 @Test void rejectsOpenRedirectAndEncodedBypasses(){for(String value:new String[]{"https://evil.test/","//evil.test","/\\evil.test","/%2fevil.test","/%252fevil.test","/%5cevil.test","/a/../x","/a/%2e%2e/x","/x%0d%0aLocation:x","/x#fragment","/auth/login","/login/oauth2/code/test","/%GG"})assertThatThrownBy(()->ReturnUrl.validate(value)).as(value).isInstanceOf(IllegalArgumentException.class);}
}