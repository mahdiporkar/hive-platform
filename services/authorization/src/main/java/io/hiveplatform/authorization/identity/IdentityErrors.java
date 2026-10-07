package io.hiveplatform.authorization.identity;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
@RestControllerAdvice(assignableTypes={IdentityController.class,IdentityAdminController.class})
class IdentityErrors {
 @ExceptionHandler(org.springframework.web.server.ResponseStatusException.class) ResponseEntity<?> status(org.springframework.web.server.ResponseStatusException error){return ResponseEntity.status(error.getStatusCode()).body(Map.of("code","IDENTITY_REQUEST_REJECTED"));}
 @ExceptionHandler(IllegalArgumentException.class) ResponseEntity<?> invalid(){return ResponseEntity.badRequest().body(Map.of("code","IDENTITY_CONFIGURATION_INVALID"));}
 @ExceptionHandler(org.springframework.dao.DataIntegrityViolationException.class) ResponseEntity<?> conflict(){return ResponseEntity.status(409).body(Map.of("code","IDENTITY_CONFLICT"));}
}