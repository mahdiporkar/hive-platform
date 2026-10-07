package io.hiveplatform.authorization.admin;

import java.util.UUID;
import org.springframework.security.core.context.SecurityContextHolder;

/**
 * The authenticated actor of the current control-plane request: a canonical Hive user (forwarded by the BFF over the
 * trusted service channel) or a deployment machine credential.
 */
public record Actor(String id, UUID userId) {
  private static final ThreadLocal<Actor> CURRENT = new ThreadLocal<>();

  public static Actor user(UUID userId) { return new Actor("user:" + userId, userId); }
  public static Actor machine(String name) { return new Actor("machine:" + name, null); }

  static void set(Actor actor) { CURRENT.set(actor); }
  static void clear() { CURRENT.remove(); }

  public static Actor current() { return CURRENT.get(); }

  public static String currentId() {
    Actor actor = CURRENT.get();
    if (actor != null) return actor.id();
    var authentication = SecurityContextHolder.getContext().getAuthentication();
    return authentication == null ? "system" : "machine:" + authentication.getName();
  }
}
