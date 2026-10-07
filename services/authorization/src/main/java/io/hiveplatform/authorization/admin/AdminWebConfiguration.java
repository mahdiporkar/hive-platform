package io.hiveplatform.authorization.admin;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
@EnableScheduling
class AdminWebConfiguration implements WebMvcConfigurer {
  private final AdminAuthorization authorization;

  AdminWebConfiguration(AdminAuthorization authorization) { this.authorization = authorization; }

  @Override
  public void addInterceptors(InterceptorRegistry registry) {
    registry.addInterceptor(authorization).addPathPatterns("/admin/**");
  }
}
