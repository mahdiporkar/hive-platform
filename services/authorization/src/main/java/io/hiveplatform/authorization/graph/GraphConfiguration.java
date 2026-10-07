package io.hiveplatform.authorization.graph;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
class GraphConfiguration {
  @Bean
  OpenFgaClient openFgaClient(@Value("${hive.openfga.url}") URI url, @Value("${hive.openfga.api-token:}") String token, ObjectMapper json) {
    return new OpenFgaClient(url, token, json);
  }
}
