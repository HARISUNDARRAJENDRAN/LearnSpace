import assert from "node:assert/strict";
import { createServer } from "node:net";
import { describe, it } from "node:test";

import { getAvailablePort } from "../src/free-port.js";

describe("getAvailablePort", () => {
  it("returns a port that is currently free on 127.0.0.1", async () => {
    const port = await getAvailablePort();
    assert.ok(Number.isInteger(port) && port > 0 && port <= 65_535);

    const probe = createServer();
    await new Promise<void>((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(port, "127.0.0.1", resolve);
    });
    await new Promise<void>((resolve, reject) =>
      probe.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it("returns distinct ports across calls", async () => {
    const [first, second] = await Promise.all([getAvailablePort(), getAvailablePort()]);
    assert.notEqual(first, second);
  });
});
