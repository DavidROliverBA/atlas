/**
 * Swagger UI for the Atlas model API — renders /api/v1/openapi.json.
 * Public page; the API endpoints themselves require a token.
 */

const HTML = `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Atlas API — Swagger</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"/>
  <style>body { margin: 0 } .topbar { display: none }</style>
</head>
<body>
  <div id="swagger"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
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
