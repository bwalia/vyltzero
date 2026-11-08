//! Serve a service's OpenAPI document without an embedded Swagger UI.
//!
//! The services used to mount `utoipa_swagger_ui::SwaggerUi`, whose build
//! script downloads and unpacks a Swagger UI zip at compile time. That pulled
//! `zip` 2.x into every build (RUSTSEC-2026-0367/0368/0369/0429) and made the
//! build depend on a network fetch. The UI was never on the public edge route
//! map anyway, so the services now publish only the machine-readable spec at
//! the same path (`/api-docs/openapi.json`); point any OpenAPI viewer at it.

use axum::{http::header, routing::get, Router};

/// Path every service publishes its OpenAPI document under.
pub const OPENAPI_PATH: &str = "/api-docs/openapi.json";

/// A router serving `spec_json` (an already-serialized OpenAPI document) at
/// [`OPENAPI_PATH`]. Serialized once at startup, so each request is a copy of
/// a string rather than a rebuild of the spec.
pub fn openapi_json_router<S>(spec_json: String) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    Router::new().route(
        OPENAPI_PATH,
        get(move || {
            let body = spec_json.clone();
            async move { ([(header::CONTENT_TYPE, "application/json")], body) }
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::{to_bytes, Body};
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    #[tokio::test]
    async fn serves_spec_as_json() {
        let app: Router = openapi_json_router(r#"{"openapi":"3.1.0"}"#.to_string());
        let res = app
            .oneshot(Request::get(OPENAPI_PATH).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(res.headers()[header::CONTENT_TYPE], "application/json");
        let body = to_bytes(res.into_body(), usize::MAX).await.unwrap();
        assert_eq!(&body[..], br#"{"openapi":"3.1.0"}"#);
    }
}
