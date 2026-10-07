package io.hiveplatform.authorization.catalog;

import java.util.EnumSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** Platform resource vocabulary and the parent types each node may hang under. Business meaning belongs to solutions. */
public enum ResourceType {
  APPLICATION, MODULE, PAGE, UI_COMPONENT, FIELD, BUSINESS_RESOURCE, EXTERNAL_RESOURCE, API_RESOURCE, DATA_RESOURCE, DATA_GOVERNANCE_RESOURCE;

  private static final Map<ResourceType, Set<ResourceType>> PARENTS = Map.of(
      APPLICATION, EnumSet.noneOf(ResourceType.class),
      MODULE, EnumSet.of(APPLICATION, MODULE),
      PAGE, EnumSet.of(MODULE, PAGE),
      UI_COMPONENT, EnumSet.of(PAGE, UI_COMPONENT),
      FIELD, EnumSet.of(PAGE, UI_COMPONENT, DATA_RESOURCE, BUSINESS_RESOURCE),
      BUSINESS_RESOURCE, EnumSet.of(APPLICATION, MODULE, BUSINESS_RESOURCE),
      EXTERNAL_RESOURCE, EnumSet.of(APPLICATION, MODULE, EXTERNAL_RESOURCE),
      API_RESOURCE, EnumSet.of(APPLICATION, MODULE, API_RESOURCE),
      DATA_RESOURCE, EnumSet.of(APPLICATION, MODULE, BUSINESS_RESOURCE, DATA_RESOURCE),
      DATA_GOVERNANCE_RESOURCE, EnumSet.of(APPLICATION, DATA_RESOURCE, DATA_GOVERNANCE_RESOURCE));

  public boolean acceptsParent(ResourceType parent) { return PARENTS.get(this).contains(parent); }

  public Set<ResourceType> allowedParents() { return PARENTS.get(this); }

  public static ResourceType parse(String value) {
    try {
      return valueOf(String.valueOf(value).toUpperCase(Locale.ROOT));
    } catch (IllegalArgumentException invalid) {
      throw new IllegalArgumentException("Unknown resource type: " + value);
    }
  }
}
