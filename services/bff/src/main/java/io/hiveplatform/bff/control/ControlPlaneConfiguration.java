package io.hiveplatform.bff.control;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Hive Core is BFF + authorization service; the BFF fails fast without its control-plane channel. */
@Configuration
class ControlPlaneConfiguration {
  @Bean
  ControlPlaneClient controlPlaneClient(@Value("${hive.control.url}") String url, @Value("${hive.control.password}") String password,
      @Value("${hive.control.allow-http:false}") boolean allowHttp, ObjectMapper json) {
    return new ControlPlaneClient(url, password, allowHttp, json);
  }
}
