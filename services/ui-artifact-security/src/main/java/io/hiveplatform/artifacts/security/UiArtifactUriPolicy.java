package io.hiveplatform.artifacts.security;

import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Shared registration and fetch-time URL policy for executable UI artifacts and manifests. */
public final class UiArtifactUriPolicy {
  public enum ArtifactType { REMOTE_ENTRY, JSON_MANIFEST, EXTERNAL_ORIGIN }
  /**
   * UNRESTRICTED is for installations where MFEs are administered explicitly and may live on
   * arbitrary networks (including outside the Docker network).  It still rejects targets that
   * are never safe for an outbound artifact fetch, such as metadata, multicast and link-local
   * addresses.
   */
  public enum NetworkMode { DEVELOPMENT, INTERNAL_ENTERPRISE, PRODUCTION_INTERNET, UNRESTRICTED }

  private static final Set<String> METADATA_HOSTS=Set.of(
      "metadata.google.internal","metadata.google","instance-data","metadata.azure.internal");
  private final NetworkMode networkMode;
  private final boolean allowHttp;
  private final String developmentHost;
  private final List<Cidr> allowedPrivateCidrs;

  public UiArtifactUriPolicy(String networkMode,boolean allowHttp,String developmentHost) {
    this(networkMode,allowHttp,developmentHost,"");
  }

  public UiArtifactUriPolicy(String networkMode,boolean allowHttp,String developmentHost,
      String allowedPrivateCidrs) {
    this.networkMode=parseMode(networkMode);
    this.allowHttp=allowHttp;
    this.developmentHost=validateDevelopmentHost(developmentHost);
    this.allowedPrivateCidrs=parseCidrs(allowedPrivateCidrs);
    // The loopback bridge is a DEVELOPMENT-only feature: outside that mode the value is
    // ignored rather than fatal, so switching an installation to UNRESTRICTED never fails
    // startup because a development default was left in the environment.
  }

  /** Offline-safe validation used when registry configuration is saved or checked at startup. */
  public URI validateConfigured(String value,ArtifactType type,String label) {
    URI uri=parse(value,label);
    validateScheme(uri,label);
    validateAuthorityAndPath(uri,label,type==ArtifactType.EXTERNAL_ORIGIN);
    String path=uri.getPath().toLowerCase(Locale.ROOT);
    if(type==ArtifactType.REMOTE_ENTRY&&!path.endsWith(".js")) {
      throw new IllegalArgumentException(label+" must be an absolute JavaScript URL");
    }
    if(type==ArtifactType.JSON_MANIFEST&&!path.endsWith(".json")) {
      throw new IllegalArgumentException(label+" must be an absolute JSON URL");
    }
    validateHostName(uri.getHost(),label);
    validateLiteralAddress(uri.getHost(),label);
    return uri;
  }

  /** Resolves DNS and enforces the selected network boundary immediately before an outbound fetch. */
  public URI prepareForFetch(String value,ArtifactType type,String label) {
    URI configured=validateConfigured(value,type,label);
    URI target=rewriteDevelopmentLoopback(configured);
    validateResolvedTarget(target,label);
    return target;
  }

  /** Resolves a federated chunk relative to its registered remoteEntry directory. */
  public URI prepareAssetForFetch(String remoteEntryUrl,String assetPath) {
    URI remote=validateConfigured(remoteEntryUrl,ArtifactType.REMOTE_ENTRY,"Remote Entry");
    String relative=assetPath==null?"":assetPath.replaceFirst("^/+","");
    String lower=relative.toLowerCase(Locale.ROOT);
    if(relative.isBlank()||relative.contains("\\")||relative.contains("?")||relative.contains("#")
        ||lower.contains("%2e")||lower.contains("%2f")||lower.contains("%5c")
        ||Arrays.stream(relative.split("/",-1)).anyMatch(part->part.equals(".")||part.equals(".."))) {
      throw new IllegalArgumentException("invalid MFE asset path");
    }
    URI base=remote.resolve(".");
    URI asset=base.resolve(relative).normalize();
    if(!origin(remote).equals(origin(asset))||!asset.getRawPath().startsWith(base.getRawPath())) {
      throw new IllegalArgumentException("MFE asset must remain below the registered artifact path");
    }
    URI target=rewriteDevelopmentLoopback(asset);
    validateResolvedTarget(target,"MFE asset");
    return target;
  }

  public NetworkMode networkMode() { return networkMode; }

  private URI rewriteDevelopmentLoopback(URI source) {
    if(networkMode!=NetworkMode.DEVELOPMENT||developmentHost.isEmpty()
        ||!isLoopbackHost(source.getHost()))return source;
    String host=developmentHost.contains(":")?"["+developmentHost+"]":developmentHost;
    String authority=host+(source.getPort()<0?"":":"+source.getPort());
    return URI.create(source.getScheme()+"://"+authority+source.getRawPath());
  }

  private void validateResolvedTarget(URI uri,String label) {
    InetAddress[] addresses;
    try { addresses=InetAddress.getAllByName(uri.getHost()); }
    catch(UnknownHostException failure) {
      throw new IllegalArgumentException(label+" hostname cannot be resolved",failure);
    }
    if(addresses.length==0)throw new IllegalArgumentException(label+" hostname cannot be resolved");
    for(InetAddress address:addresses)validateAddress(address,label);
  }

  private void validateLiteralAddress(String host,String label) {
    // A loopback *name* has a known address; judging it at registration time keeps
    // registration and fetch-time policy in agreement (a localhost MFE must not be
    // saveable in a mode whose runtime fetch will refuse it).
    if(isLoopbackHost(host)) {
      validateAddress(InetAddress.getLoopbackAddress(),label);
      return;
    }
    if(!isIpLiteral(host))return;
    try { validateAddress(InetAddress.getByName(host),label); }
    catch(UnknownHostException failure) {
      throw new IllegalArgumentException(label+" contains an invalid IP address",failure);
    }
  }

  private void validateAddress(InetAddress address,String label) {
    byte[] bytes=ipv4Bytes(address.getAddress());
    if(address.isAnyLocalAddress()||address.isLinkLocalAddress()||address.isMulticastAddress()
        ||isReserved(bytes)||isMetadataAddress(bytes)) {
      throw new IllegalArgumentException(label+" target is blocked by the UI artifact network policy");
    }
    if(networkMode!=NetworkMode.DEVELOPMENT&&networkMode!=NetworkMode.UNRESTRICTED
        &&address.isLoopbackAddress()) {
      throw new IllegalArgumentException(label+" loopback target is blocked by the UI artifact network policy");
    }
    boolean privateTarget=address.isSiteLocalAddress()
        ||isPrivateOrSpecial(address.getAddress(),bytes);
    if(networkMode==NetworkMode.PRODUCTION_INTERNET&&privateTarget) {
      throw new IllegalArgumentException(label+" private target is blocked by PRODUCTION_INTERNET policy");
    }
    if(networkMode==NetworkMode.INTERNAL_ENTERPRISE&&privateTarget
        &&allowedPrivateCidrs.stream().noneMatch(cidr->cidr.contains(address))) {
      throw new IllegalArgumentException(
          label+" private target is outside HIVE_ARTIFACT_ALLOWED_PRIVATE_CIDRS");
    }
  }

  private void validateScheme(URI uri,String label) {
    String scheme=uri.getScheme()==null?"":uri.getScheme().toLowerCase(Locale.ROOT);
    if(!"https".equals(scheme)&&!(allowHttp&&"http".equals(scheme))) {
      throw new IllegalArgumentException(label+" must use HTTPS");
    }
  }

  private static URI parse(String value,String label) {
    if(value==null||value.isBlank())throw new IllegalArgumentException("Invalid "+label+" URL");
    try { return URI.create(value.trim()).normalize(); }
    catch(RuntimeException invalid) {
      throw new IllegalArgumentException("Invalid "+label+" URL",invalid);
    }
  }

  private static void validateAuthorityAndPath(URI uri,String label,boolean allowOriginPath) {
    String rawPath=uri.getRawPath();
    String lower=rawPath==null?"":rawPath.toLowerCase(Locale.ROOT);
    if(!uri.isAbsolute()||uri.isOpaque()||uri.getHost()==null||uri.getUserInfo()!=null
        ||uri.getQuery()!=null||uri.getFragment()!=null||rawPath==null
        ||(!allowOriginPath&&rawPath.isBlank())
        ||rawPath.contains("\\")||lower.contains("%2e")||lower.contains("%2f")
        ||lower.contains("%5c")) {
      throw new IllegalArgumentException(
          label+" must be an absolute URL without credentials, query, fragment, or encoded traversal");
    }
  }

  private static void validateHostName(String host,String label) {
    String normalized=host.toLowerCase(Locale.ROOT).replaceFirst("[.]$","");
    if(METADATA_HOSTS.contains(normalized)||normalized.endsWith(".metadata.google.internal")) {
      throw new IllegalArgumentException(label+" metadata target is blocked");
    }
    if(isLoopbackHost(normalized))return;
    if(!isIpLiteral(normalized)&&!normalized.matches(
        "(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?[.])*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?")) {
      throw new IllegalArgumentException(label+" hostname is invalid");
    }
  }

  private static NetworkMode parseMode(String value) {
    String normalized=value==null?"":value.trim().toUpperCase(Locale.ROOT);
    return switch(normalized) {
      case "DEV","DEVELOPMENT" -> NetworkMode.DEVELOPMENT;
      case "INTERNAL","INTERNAL_ENTERPRISE" -> NetworkMode.INTERNAL_ENTERPRISE;
      case "PRODUCTION","PRODUCTION_INTERNET" -> NetworkMode.PRODUCTION_INTERNET;
      case "ANY","UNRESTRICTED" -> NetworkMode.UNRESTRICTED;
      default -> throw new IllegalArgumentException("Unknown UI artifact network policy: "+value);
    };
  }

  private static String validateDevelopmentHost(String value) {
    if(value==null||value.isBlank())return "";
    String host=value.trim();
    try {
      URI candidate=URI.create("http://"+(host.contains(":")?"["+host+"]":host));
      if(candidate.getHost()==null||candidate.getPort()!=-1||candidate.getPath()==null
          ||!candidate.getPath().isEmpty())throw new IllegalArgumentException();
      validateHostName(candidate.getHost(),"UI artifact development host");
      return candidate.getHost();
    } catch(RuntimeException invalid) {
      throw new IllegalArgumentException(
          "UI artifact development host must be one hostname or IP address",invalid);
    }
  }

  private static boolean isLoopbackHost(String host) {
    return "localhost".equalsIgnoreCase(host)||"127.0.0.1".equals(host)||"::1".equals(host);
  }

  private static boolean isIpLiteral(String host) {
    return host.contains(":")||host.matches("[0-9]{1,3}(?:[.][0-9]{1,3}){3}");
  }

  private static String origin(URI uri) {
    return uri.getScheme().toLowerCase(Locale.ROOT)+"://"+uri.getHost().toLowerCase(Locale.ROOT)
        +(uri.getPort()<0?"":":"+uri.getPort());
  }

  private static byte[] ipv4Bytes(byte[] bytes) {
    if(bytes.length==4)return bytes;
    boolean mapped=bytes.length==16;
    for(int i=0;mapped&&i<10;i++)mapped=bytes[i]==0;
    mapped=mapped&&bytes[10]==(byte)0xff&&bytes[11]==(byte)0xff;
    return mapped?Arrays.copyOfRange(bytes,12,16):null;
  }

  private static boolean isReserved(byte[] ipv4) {
    if(ipv4==null)return false;
    int first=Byte.toUnsignedInt(ipv4[0]);
    return first==0||first>=240;
  }

  private static boolean isMetadataAddress(byte[] ipv4) {
    if(ipv4==null)return false;
    int a=Byte.toUnsignedInt(ipv4[0]),b=Byte.toUnsignedInt(ipv4[1]);
    int c=Byte.toUnsignedInt(ipv4[2]),d=Byte.toUnsignedInt(ipv4[3]);
    return (a==169&&b==254&&c==169&&d==254)
        ||(a==100&&b==100&&c==100&&d==200)
        ||(a==168&&b==63&&c==129&&d==16);
  }

  private static boolean isPrivateOrSpecial(byte[] original,byte[] ipv4) {
    if(ipv4!=null) {
      int a=Byte.toUnsignedInt(ipv4[0]),b=Byte.toUnsignedInt(ipv4[1]);
      int c=Byte.toUnsignedInt(ipv4[2]);
      return a==10||(a==172&&b>=16&&b<=31)||(a==192&&b==168)
          ||(a==100&&b>=64&&b<=127)||(a==198&&(b==18||b==19))
          ||(a==192&&b==0&&(c==0||c==2))
          ||(a==198&&b==51&&c==100)||(a==203&&b==0&&c==113);
    }
    int first=Byte.toUnsignedInt(original[0]),second=Byte.toUnsignedInt(original[1]);
    return (first&0xfe)==0xfc||(first==0x20&&second==0x01
        &&Byte.toUnsignedInt(original[2])==0x0d&&Byte.toUnsignedInt(original[3])==0xb8);
  }

  private static List<Cidr> parseCidrs(String value) {
    if(value==null||value.isBlank())return List.of();
    return Arrays.stream(value.split(",")).map(String::trim).filter(item->!item.isEmpty())
        .map(Cidr::parse).toList();
  }

  private record Cidr(byte[] network,int prefix) {
    private static Cidr parse(String value) {
      String[] parts=value.split("/",-1);
      if(parts.length!=2||!isIpLiteral(parts[0]))
        throw new IllegalArgumentException("Invalid private network CIDR: "+value);
      try {
        byte[] address=InetAddress.getByName(parts[0]).getAddress();
        int bits=Integer.parseInt(parts[1]);
        if(bits<0||bits>address.length*8)
          throw new IllegalArgumentException("Invalid private network CIDR: "+value);
        return new Cidr(address,bits);
      } catch(Exception invalid) {
        throw new IllegalArgumentException("Invalid private network CIDR: "+value,invalid);
      }
    }

    private boolean contains(InetAddress candidate) {
      byte[] address=candidate.getAddress();
      if(address.length!=network.length)return false;
      int whole=prefix/8,remainder=prefix%8;
      for(int i=0;i<whole;i++)if(address[i]!=network[i])return false;
      if(remainder==0)return true;
      int mask=0xff<<(8-remainder);
      return (Byte.toUnsignedInt(address[whole])&mask)
          ==(Byte.toUnsignedInt(network[whole])&mask);
    }
  }
}
