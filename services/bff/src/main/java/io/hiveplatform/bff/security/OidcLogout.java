package io.hiveplatform.bff.security;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.web.authentication.logout.LogoutHandler;
import org.springframework.security.web.authentication.logout.LogoutSuccessHandler;
import org.springframework.security.web.util.UrlUtils;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * Sign-out ends the Hive session and, through OIDC RP-initiated logout, the identity provider's session too. Ending only
 * the local session would leave the provider's SSO session alive, and the next sign-in (which shells start
 * automatically) would silently re-authenticate the same person without credentials.
 *
 * <p>{@code POST /auth/logout} (CSRF-protected) deletes the vault record and invalidates the session, then answers
 * {@code 200 {"logoutUrl": …}} with the provider's {@code end_session_endpoint}, {@code id_token_hint},
 * {@code client_id} and {@code post_logout_redirect_uri} (this deployment's origin, derived like the login redirect
 * URI, so it is correct behind a TLS-terminating proxy and is checked by the provider against the client's registered
 * post-logout redirect URIs). The browser navigates there; a script-initiated request cannot follow a cross-origin
 * redirect. Without a provider session to end (no session, or a provider without an end-session endpoint) the answer
 * stays {@code 204}.
 */
final class OidcLogout {
 private static final String PROVIDER="HIVE_LOGOUT_PROVIDER",ID_TOKEN="HIVE_LOGOUT_ID_TOKEN";
 private OidcLogout(){}

 /** Captures what the provider logout needs from the vault record, then deletes it (tokens never outlive the session). */
 static LogoutHandler endVaultRecord(TokenVault vault) {
  return (request,response,authentication)->{
   var session=request.getSession(false);
   if(session==null||!(session.getAttribute(IdentityConfiguration.VAULT_HANDLE) instanceof String handle))return;
   try{var record=vault.read(handle);request.setAttribute(PROVIDER,record.providerId());request.setAttribute(ID_TOKEN,record.idToken());}
   catch(RuntimeException expired){/* expired or unreadable: nothing to hand to the provider */}
   vault.delete(handle);
  };
 }

 static LogoutSuccessHandler providerLogout(ClientRegistrationRepository registrations,ObjectMapper json) {
  return (request,response,authentication)->{
   response.setHeader("Cache-Control","no-store");
   String url=null;
   if(request.getAttribute(PROVIDER) instanceof String provider&&request.getAttribute(ID_TOKEN) instanceof String idToken){
    // The local session has already ended; an unavailable provider must not turn sign-out into an error.
    try{var registration=registrations.findByRegistrationId(provider);if(registration!=null)url=endSessionUrl(registration,idToken,postLogoutRedirectUri(request));}
    catch(RuntimeException unavailable){url=null;}
   }
   if(url==null){response.setStatus(204);return;}
   response.setStatus(200);response.setContentType("application/json");
   json.writeValue(response.getOutputStream(),Map.of("logoutUrl",url));
  };
 }

 /** The provider's end-session request, or null when it advertises no end-session endpoint. */
 static String endSessionUrl(ClientRegistration registration,String idToken,String postLogoutRedirectUri) {
  Object endpoint=registration.getProviderDetails().getConfigurationMetadata().get("end_session_endpoint");
  if(!(endpoint instanceof String location)||location.isBlank())return null;
  return UriComponentsBuilder.fromUriString(location)
   .queryParam("id_token_hint",idToken)
   .queryParam("client_id",registration.getClientId())
   .queryParam("post_logout_redirect_uri",postLogoutRedirectUri)
   .encode().build().toUriString();
 }

 /** This deployment's root, as the browser addresses it (same derivation as {baseUrl} of the login redirect URI). */
 static String postLogoutRedirectUri(HttpServletRequest request) {
  return UriComponentsBuilder.fromUriString(UrlUtils.buildFullRequestUrl(request)).replacePath(request.getContextPath()+"/")
   .replaceQuery(null).fragment(null).build().toUriString();
 }
}
