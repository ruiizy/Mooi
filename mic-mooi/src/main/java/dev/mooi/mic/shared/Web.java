package dev.mooi.mic.shared;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.ErrorResponseException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;

/**
 * Transversal aspect: HTTP edge.
 *
 * <p>Owns CORS for the SPA origin and the single error contract returned by every endpoint. The CORS
 * mapping covers the whole surface because the auth endpoints are mounted at the root, next to the
 * {@code /api} features.
 */
@Configuration
public class Web {

    @Bean
    WebMvcConfigurer corsConfigurer(@Value("${app.cors.allowed-origins}") String[] allowedOrigins) {
        return new WebMvcConfigurer() {
            @Override
            public void addCorsMappings(CorsRegistry registry) {
                registry.addMapping("/**")
                        .allowedOrigins(allowedOrigins)
                        .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                        .allowedHeaders("*")
                        .allowCredentials(true)
                        .exposedHeaders(Logging.CORRELATION_ID_HEADER)
                        .maxAge(3600);
            }
        };
    }

    /** Error contract shared by every endpoint. */
    public record ApiError(OffsetDateTime timestamp, int status, String error, String message, String path,
                           String correlationId, List<FieldIssue> issues) {

        public record FieldIssue(String field, String message) {
        }
    }

    @Slf4j
    @RestControllerAdvice
    static class ApiErrorHandler {

        @ExceptionHandler(MethodArgumentNotValidException.class)
        ResponseEntity<ApiError> onValidation(MethodArgumentNotValidException exception, HttpServletRequest request) {
            List<ApiError.FieldIssue> issues = exception.getBindingResult().getFieldErrors().stream()
                    .map(error -> new ApiError.FieldIssue(error.getField(), error.getDefaultMessage()))
                    .toList();
            return build(HttpStatus.BAD_REQUEST, "Request validation failed", request, issues);
        }

        @ExceptionHandler(HttpMessageNotReadableException.class)
        ResponseEntity<ApiError> onUnreadableBody(HttpMessageNotReadableException exception,
                                                  HttpServletRequest request) {
            return build(HttpStatus.BAD_REQUEST, "Request body is missing or malformed", request, List.of());
        }

        @ExceptionHandler(ResponseStatusException.class)
        ResponseEntity<ApiError> onResponseStatus(ResponseStatusException exception, HttpServletRequest request) {
            HttpStatus status = resolve(exception.getStatusCode());
            String message = exception.getReason() != null ? exception.getReason() : status.getReasonPhrase();
            return build(status, message, request, List.of());
        }

        @ExceptionHandler(ErrorResponseException.class)
        ResponseEntity<ApiError> onErrorResponse(ErrorResponseException exception, HttpServletRequest request) {
            HttpStatus status = resolve(exception.getStatusCode());
            return build(status, exception.getBody().getDetail() != null
                    ? exception.getBody().getDetail() : status.getReasonPhrase(), request, List.of());
        }

        @ExceptionHandler(Exception.class)
        ResponseEntity<ApiError> onUnexpected(Exception exception, HttpServletRequest request) {
            log.error("Unhandled failure on {} {}", request.getMethod(), request.getRequestURI(), exception);
            return build(HttpStatus.INTERNAL_SERVER_ERROR, "Unexpected server error", request, List.of());
        }

        private HttpStatus resolve(HttpStatusCode statusCode) {
            HttpStatus status = HttpStatus.resolve(statusCode.value());
            return status != null ? status : HttpStatus.INTERNAL_SERVER_ERROR;
        }

        private ResponseEntity<ApiError> build(HttpStatus status, String message, HttpServletRequest request,
                                               List<ApiError.FieldIssue> issues) {
            ApiError body = new ApiError(OffsetDateTime.now(ZoneOffset.UTC), status.value(), status.getReasonPhrase(),
                    message, request.getRequestURI(), Logging.currentCorrelationId(), issues);
            return ResponseEntity.status(status).body(body);
        }
    }
}
