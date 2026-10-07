package io.hiveplatform.authorization.graph;

import java.util.Locale;
import java.util.UUID;

/** Canonical OpenFGA object and subject identifiers. All identifiers are opaque UUIDs, never business keys. */
public final class Graph {
  public static final String PLATFORM = "platform:hive";
  public static final String MANAGE = "manage";

  public enum SubjectType { USER, GROUP, ROLE }

  public enum PlatformRole {
    SUPER_ADMIN("super_admin"), OPERATOR("operator"), SECURITY_ADMIN("security_admin"),
    INTEGRATION_ADMIN("integration_admin"), AUDITOR("auditor");
    public final String relation;
    PlatformRole(String relation) { this.relation = relation; }
  }

  private Graph() {}

  public static String user(UUID id) { return "user:" + id; }
  public static String resource(UUID id) { return "resource:" + id; }
  public static String action(UUID resourceId, String actionKey) { return "action:" + resourceId + "." + actionKey; }

  public static String subject(SubjectType type, UUID id) {
    return switch (type) {
      case USER -> "user:" + id;
      case GROUP -> "group:" + id + "#member";
      case ROLE -> "role:" + id + "#assignee";
    };
  }

  public static SubjectType subjectType(String value) {
    try {
      return SubjectType.valueOf(value.toUpperCase(Locale.ROOT));
    } catch (RuntimeException invalid) {
      throw new IllegalArgumentException("subjectType must be USER, GROUP or ROLE");
    }
  }

  /** Grant relation for an action: {@code manage} is inherited down the tree; other actions are per-action objects. */
  public static OpenFgaClient.Tuple grant(String subject, UUID resourceId, String actionKey) {
    return MANAGE.equals(actionKey)
        ? new OpenFgaClient.Tuple(subject, "manager", resource(resourceId))
        : new OpenFgaClient.Tuple(subject, "grantee", action(resourceId, actionKey));
  }

  public static OpenFgaClient.Tuple decision(UUID userId, UUID resourceId, String actionKey) {
    return MANAGE.equals(actionKey)
        ? new OpenFgaClient.Tuple(user(userId), "manager", resource(resourceId))
        : new OpenFgaClient.Tuple(user(userId), "allowed", action(resourceId, actionKey));
  }
}
