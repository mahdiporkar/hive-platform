package io.hiveplatform.authorization.routing;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

class RoutePathPolicyTest {
  @Test void canonicalizesPrefixesAndMatchesSafeTemplates() {
    assertEquals("/records-api/",RoutePathPolicy.prefix("/records-api"));
    assertTrue(RoutePathPolicy.matches("/api/v1/items/{id}","/api/v1/items/42"));
    assertTrue(RoutePathPolicy.matches("/api/v1/**","/api/v1/items/42"));
    assertFalse(RoutePathPolicy.matches("/api/v1/items/{id}","/api/v1/items/42/audit"));
  }

  @Test void rejectsTraversalEncodedSlashDuplicateSlashAndAdministratorRegex() {
    for(String attack:new String[]{"/svc/../secret","/svc/%2e%2e/secret","/svc//items","/svc\\items","/svc/%2fadmin"})
      assertThrows(IllegalArgumentException.class,()->RoutePathPolicy.path(attack));
    assertThrows(IllegalArgumentException.class,()->RoutePathPolicy.pattern("/api/(.*)"));
  }

  @Test void administratorPatternLanguageIsExactlyLiteralsVariablesStarAndTerminalDoubleStar() {
    for(String valid:new String[]{"/","/items","/items/{id}","/items/*","/files/**","/**",
        "/a.b_c~d-e/{orderId}/lines/*"})
      assertDoesNotThrow(()->RoutePathPolicy.pattern(valid),valid);
    for(String invalid:new String[]{"/files/**/more","/items/{id","/items/{1id}","/emp loyees",
        "/items?x=1","/items#frag","/items/%20","/items/..","/items//x","/items\\x",
        "/items/{a-b}","/emp*loyees"})
      assertThrows(IllegalArgumentException.class,()->RoutePathPolicy.pattern(invalid),invalid);
  }

  @Test void runtimePathsKeepSafeEncodingsButRejectStructuralOrMalformedOnes() {
    assertEquals("/items/Item%20One",RoutePathPolicy.path("/items/Item%20One"));
    assertEquals("/x/%D8%B9%D9%84%DB%8C",RoutePathPolicy.path("/x/%D8%B9%D9%84%DB%8C"));
    for(String bad:new String[]{"/a/%2F","/a/%5c","/a/%2E%2E","/a/%3f","/a/%23","/a/%25","/a/%zz","/a/%2"})
      assertThrows(IllegalArgumentException.class,()->RoutePathPolicy.path(bad),bad);
    // Definitions never carry encodings at all.
    assertThrows(IllegalArgumentException.class,()->RoutePathPolicy.definition("/a/%20b"));
    assertThrows(IllegalArgumentException.class,()->RoutePathPolicy.prefix("/api/%20"));
  }

  @Test void rootPatternMatchesOnlyThePrefixItself() {
    assertTrue(RoutePathPolicy.matches("/","/"));
    assertFalse(RoutePathPolicy.matches("/","/anything"));
    assertTrue(RoutePathPolicy.matches("/items/*","/items/42"));
    assertFalse(RoutePathPolicy.matches("/items/*","/items/42/x"));
    assertFalse(RoutePathPolicy.matches("/items/*","/items"));
  }

  @Test void literalPatternsAreMoreSpecificThanVariablesAndWildcards() {
    assertTrue(RoutePathPolicy.specificity("/api/v1/items/current")
        > RoutePathPolicy.specificity("/api/v1/items/{id}"));
    assertTrue(RoutePathPolicy.specificity("/api/v1/items/{id}")
        > RoutePathPolicy.specificity("/api/v1/**"));
  }
}
