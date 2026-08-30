import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 4010);
const email = process.env.AUTH_TEST_GOOGLE_EMAIL ?? "google-e2e@example.test";
const subject = process.env.AUTH_TEST_GOOGLE_SUB ?? "playwright-google-sub";

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);

  if (url.pathname === "/health") {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("ok");
    return;
  }

  if (url.pathname === "/o/oauth2/v2/auth") {
    const redirectUri = url.searchParams.get("redirect_uri");
    const state = url.searchParams.get("state");
    if (!redirectUri || !state) {
      response.writeHead(400);
      response.end("missing OAuth parameters");
      return;
    }
    const callback = new URL(redirectUri);
    callback.searchParams.set("code", "playwright-code");
    callback.searchParams.set("state", state);
    response.writeHead(302, { Location: callback.toString() });
    response.end();
    return;
  }

  if (url.pathname === "/token") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ access_token: "playwright-access-token" }));
    return;
  }

  if (url.pathname === "/userinfo") {
    if (request.headers.authorization !== "Bearer playwright-access-token") {
      response.writeHead(401);
      response.end("unauthorized");
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        sub: subject,
        email,
        email_verified: true,
        name: "Google Learner",
      }),
    );
    return;
  }

  response.writeHead(404);
  response.end("not found");
});

server.listen(port, "127.0.0.1");

function shutdown() {
  server.close(() => process.exit(0));
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
