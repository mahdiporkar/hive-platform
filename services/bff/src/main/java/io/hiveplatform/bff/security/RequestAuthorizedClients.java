package io.hiveplatform.bff.security;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClient;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizedClientRepository;
/** Transient handoff from the OAuth filter to the login success handler, never persisted. */
public final class RequestAuthorizedClients implements OAuth2AuthorizedClientRepository {
 private static final String KEY=RequestAuthorizedClients.class.getName();
 @SuppressWarnings("unchecked") public <T extends OAuth2AuthorizedClient>T loadAuthorizedClient(String id,Authentication principal,HttpServletRequest request){return (T)request.getAttribute(KEY);}
 public void saveAuthorizedClient(OAuth2AuthorizedClient client,Authentication principal,HttpServletRequest request,HttpServletResponse response){request.setAttribute(KEY,client);}
 public void removeAuthorizedClient(String id,Authentication principal,HttpServletRequest request,HttpServletResponse response){request.removeAttribute(KEY);}
}