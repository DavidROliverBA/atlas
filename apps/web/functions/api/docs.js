/**
 * Swagger UI for the Atlas model API — renders /api/v1/openapi.json.
 * Public page; the API endpoints themselves require a token.
 *
 * swagger-ui-dist is pinned to an exact version (not the `@5` floating tag)
 * with Subresource Integrity hashes, so unpkg serving a tampered or
 * unexpectedly-updated file fails closed instead of silently executing.
 * Hashes were computed by fetching these exact files from unpkg and hashing
 * them with `openssl dgst -sha384 -binary | openssl base64 -A`; re-derive
 * them the same way if the pinned version ever changes.
 */

const SWAGGER_UI_VERSION = "5.32.9";
const SWAGGER_UI_CSS_INTEGRITY = "sha384-9Q2fpS+xeS4ffJy6CagnwoUl+4ldAYhOs9pgZuEKxypVModhmZFzeMlvVsAjf7uT";
const SWAGGER_UI_BUNDLE_INTEGRITY = "sha384-7FpIrfnye9wip2SqkAsMf4AwNYHk26Vh4hFxfZsWK6dr1Zr2Ig5fk25hy9lNlGHq";

const HTML = `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Atlas API — Swagger</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui.css" integrity="${SWAGGER_UI_CSS_INTEGRITY}" crossorigin="anonymous"/>
  <style>body { margin: 0 } .topbar { display: none }</style>
</head>
<body>
  <div id="swagger"></div>
  <script src="https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui-bundle.js" integrity="${SWAGGER_UI_BUNDLE_INTEGRITY}" crossorigin="anonymous"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: "/api/v1/openapi.json",
      dom_id: "#swagger",
      deepLinking: true,
      persistAuthorization: true,
      tryItOutEnabled: true,
    });
  </script>
</body>
</html>`;

export function onRequestGet() {
  return new Response(HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
}
