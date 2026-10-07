package io.hiveplatform.bff.security;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
public final class ReturnUrl {
 private ReturnUrl() {}
 public static String validate(String value) {
  if(value==null)return "/";
  if(value.length()>2048||!value.startsWith("/")||value.startsWith("//"))throw invalid();
  String decoded=value;
  for(int round=0;round<4;round++) {
   if(decoded.codePoints().anyMatch(c->c<32||c==127)||decoded.indexOf('\\')>=0||decoded.startsWith("//"))throw invalid();
   String next;
   try {next=URLDecoder.decode(decoded,StandardCharsets.UTF_8);}catch(IllegalArgumentException e){throw invalid();}
   if(next.equals(decoded))break;
   decoded=next;
   if(round==3)throw invalid();
  }
  try {
   var uri=URI.create(value);
   if(uri.isAbsolute()||uri.getRawAuthority()!=null||uri.getRawFragment()!=null||!uri.normalize().equals(uri))throw invalid();
   String path=decoded.split("\\?",2)[0];
   if(path.contains("//")||java.util.Arrays.stream(path.split("/")).anyMatch(s->s.equals(".")||s.equals("..")))throw invalid();
   if(path.toLowerCase(Locale.ROOT).startsWith("/auth/")||path.startsWith("/login/oauth2/"))throw invalid();
   return value;
  }catch(IllegalArgumentException e){throw invalid();}
 }
 private static IllegalArgumentException invalid(){return new IllegalArgumentException("returnUrl must be a local application path without redirects or traversal");}
}