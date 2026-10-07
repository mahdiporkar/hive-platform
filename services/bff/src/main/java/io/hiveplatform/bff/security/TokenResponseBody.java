package io.hiveplatform.bff.security;
import java.io.IOException;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.util.List;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Flow;
/** Cancels an oversized response while receiving it, before allocating the full body. */
final class TokenResponseBody {
 private TokenResponseBody() {}
 static HttpResponse.BodyHandler<byte[]> limited(int maximum){
  return info->new HttpResponse.BodySubscriber<byte[]>(){
   final HttpResponse.BodySubscriber<byte[]> delegate=HttpResponse.BodySubscribers.ofByteArray();
   Flow.Subscription subscription;long size;boolean done;
   public CompletionStage<byte[]> getBody(){return delegate.getBody();}
   public void onSubscribe(Flow.Subscription value){subscription=value;delegate.onSubscribe(value);}
   public void onNext(List<ByteBuffer> buffers){
    if(done)return;
    for(var buffer:buffers)size+=buffer.remaining();
    if(size>maximum){done=true;subscription.cancel();delegate.onError(new IOException("Token response exceeds size limit"));return;}
    delegate.onNext(buffers);
   }
   public void onError(Throwable error){if(!done){done=true;delegate.onError(error);}}
   public void onComplete(){if(!done){done=true;delegate.onComplete();}}
  };
 }
}