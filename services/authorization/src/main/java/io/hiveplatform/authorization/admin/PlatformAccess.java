package io.hiveplatform.authorization.admin;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Declares the platform relation (on {@code platform:hive}) required for an administrative handler.
 * On a class, {@link #read()} applies to GET/HEAD and {@link #value()} to all other methods; a method annotation overrides both.
 * Handlers without a declaration are denied.
 */
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.TYPE, ElementType.METHOD})
public @interface PlatformAccess {
  Relation value();
  Relation read() default Relation.READER;

  enum Relation {
    READER("reader"), OPERATOR("operator"), SECURITY_ADMIN("security_admin"), INTEGRATION_ADMIN("integration_admin"),
    AUDITOR("auditor"), SUPER_ADMIN("super_admin");
    public final String relation;
    Relation(String relation) { this.relation = relation; }
  }
}
