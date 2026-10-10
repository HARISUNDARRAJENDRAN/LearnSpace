import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import { waitForServer } from "../src/server-ready.js";

describe("waitForServer", () => {
  let server: ReturnType<typeof createServer>;
  let url: string;

  before(async () => {
    server = createServer((request, response) => {
      if (request.url === "/api/health") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
        return;
      }
      response.writeHead(404);
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it("resolves once the health endpoint reports OK", async () => {
    await waitForServer(`${url}/api/health`, { timeoutMs: 5_000, intervalMs: 100 });
  });

  it("rejects with a timeout error when the endpoint never becomes healthy", async () => {
    await assert.rejects(
      waitForServer("http://127.0.0.1:9/api/health", { timeoutMs: 300, intervalMs: 50 }),
      /timed out/,
    );
  });

  it("keeps polling through non-2xx responses until success", async () => {
    let requests = 0;
    const flaky = createServer((_request, response) => {
      requests += 1;
      if (requests < 3) {
        response.writeHead(503);
        response.end();
        return;
      }
      response.writeHead(200);
      response.end();
    });
    await new Promise<void>((resolve) => flaky.listen(0, "127.0.0.1", resolve));
    const flakyUrl = `http://127.0.0.1:${(flaky.address() as AddressInfo).port}/api/health`;
    try {
      await waitForServer(flakyUrl, { timeoutMs: 5_000, intervalMs: 50 });
      assert.ok(requests >= 3);
    } finally {
      await new Promise<void>((resolve, reject) =>
        flaky.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
