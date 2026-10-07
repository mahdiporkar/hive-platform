package io.hiveplatform.spring;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.core.Ordered;

@AutoConfiguration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@Import(PlatformErrors.class)
public class HiveAutoConfiguration {
  @Bean
  FilterRegistrationBean<CorrelationId> hiveCorrelationId() {
    var registration = new FilterRegistrationBean<>(new CorrelationId());
    registration.setOrder(Ordered.HIGHEST_PRECEDENCE);
    return registration;
  }
}
