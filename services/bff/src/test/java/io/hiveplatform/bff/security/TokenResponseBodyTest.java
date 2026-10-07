package io.hiveplatform.bff.security;
import java.nio.ByteBuffer;
import java.util.List;
import java.util.concurrent.Flow;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;
class TokenResponseBodyTest {
 @Test void cancelsBeforeBufferingOversize(){var canceled=new AtomicBoolean();var subscriber=TokenResponseBody.limited(4).apply(null);subscriber.onSubscribe(new Flow.Subscription(){public void request(long n){}public void cancel(){canceled.set(true);}});subscriber.onNext(List.of(ByteBuffer.wrap(new byte[5])));assertThat(canceled).isTrue();assertThatThrownBy(()->subscriber.getBody().toCompletableFuture().join()).hasCauseInstanceOf(java.io.IOException.class);}
 @Test void acceptsExactBound(){var subscriber=TokenResponseBody.limited(4).apply(null);subscriber.onSubscribe(new Flow.Subscription(){public void request(long n){}public void cancel(){}});subscriber.onNext(List.of(ByteBuffer.wrap(new byte[]{1,2}),ByteBuffer.wrap(new byte[]{3,4})));subscriber.onComplete();assertThat(subscriber.getBody().toCompletableFuture().join()).containsExactly(1,2,3,4);}
}