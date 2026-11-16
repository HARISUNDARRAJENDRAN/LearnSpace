import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import Docker from "dockerode";
import type { ExecuteRequest, ExecuteResponse } from "./protocol.js";
import { createExecutor } from "./executor.js";
import { createSandbox } from "./sandbox.js";
import { createRunnerServer } from "./server.js";

// These run real containers: they need Docker and the sandbox image (`pnpm sandbox:build`).
const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET ?? "/var/run/docker.sock" });
const image = process.env.SANDBOX_IMAGE ?? "learnspace-sandbox:1";
const available = await docker.getImage(image).inspect().then(() => true, () => false);
const skip = available ? false : `Docker with the ${image} image is required`;
const token = "test-token-0123456789";
let url = "";
let close = () => undefined as void;

before(async () => {
  if (!available) return;
  process.env.LEARNSPACE_SECRET_PROBE = "must-not-leak";
  const sandbox = createSandbox(docker, { image, runtime: process.env.SANDBOX_RUNTIME, cpus: 1 });
  const server = createRunnerServer({ token, execute: createExecutor(sandbox.execute, { concurrency: 4, queue: 4 }), store: null });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => { server.close(); };
});
after(() => close());

async function execute(body: ExecuteRequest, auth = token): Promise<{ status: number; body: ExecuteResponse & { error?: string } }> {
  const response = await fetch(`${url}/v1/execute`, { method: "POST", headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() as ExecuteResponse & { error?: string } };
}

const python = (source: string, timeoutMs = 3_000, stdin = "") => execute({ language: "python", files: { "main.py": source }, runs: [{ stdin, timeoutMs }] });

test("a request without the runner's token is refused", { skip }, async () => {
  const result = await execute({ language: "python", files: { "main.py": "print(1)" }, runs: [{ stdin: "", timeoutMs: 1_000 }] }, "wrong-token-0123456789");
  assert.equal(result.status, 401);
});

test("each language compiles and runs as nobody, with results on fd 3", { skip }, async () => {
  const cases: Array<[ExecuteRequest["language"], Record<string, string>]> = [
    ["python", { "main.py": "import os, sys\nos.write(3, b'R')\nprint(os.getuid(), sys.stdin.read())" }],
    ["javascript", { "main.js": "require('fs').writeSync(3, 'R'); console.log(process.getuid(), require('fs').readFileSync(0, 'utf8'))" }],
    ["typescript", { "main.ts": "const fs = require('fs'); const tag: string = 'R'; fs.writeSync(3, tag); console.log(process.getuid(), fs.readFileSync(0, 'utf8'))" }],
    ["cpp", { "main.cpp": "#include <bits/stdc++.h>\n#include <unistd.h>\nint main(){ write(3, \"R\", 1); std::string s; std::cin >> s; std::cout << getuid() << ' ' << s << std::endl; }" }],
    ["java", { "Main.java": "import java.io.*;\npublic class Main { public static void main(String[] a) throws Exception { FileDescriptor fd = new FileDescriptor(); java.lang.reflect.Field f = FileDescriptor.class.getDeclaredField(\"fd\"); f.setAccessible(true); f.setInt(fd, 3); new FileOutputStream(fd).write('R'); System.out.println(new Solution().uid() + \" \" + new BufferedReader(new InputStreamReader(System.in)).readLine()); } }", "Solution.java": "class Solution { String uid() { return \"65534\"; } }" }],
  ];
  for (const [language, files] of cases) {
    const result = await execute({ language, files, runs: [{ stdin: "hello", timeoutMs: 5_000 }] });
    assert.equal(result.status, 200, language);
    assert.equal(result.body.runs[0]?.status, "ok", `${language}: ${JSON.stringify(result.body)}`);
    assert.match(result.body.runs[0]!.stdout, /^65534 hello/, language);
    assert.equal(result.body.runs[0]!.result, "R", language);
  }
});

test("a compile error is reported without running", { skip }, async () => {
  const result = await execute({ language: "cpp", files: { "main.cpp": "int main() { return x; }" }, runs: [{ stdin: "", timeoutMs: 1_000 }] });
  assert.equal(result.body.compile?.ok, false);
  assert.match(result.body.compile!.output, /x/);
  assert.equal(result.body.runs.length, 0);
});

test("an infinite loop stops at its time limit", { skip }, async () => {
  const started = Date.now();
  const result = await python("while True:\n    pass", 1_000);
  assert.equal(result.body.runs[0]?.status, "timeout");
  assert.ok(Date.now() - started < 10_000);
});

test("runaway memory is contained by the memory limit", { skip }, async () => {
  const result = await execute({ language: "python", files: { "main.py": "a = []\nwhile True:\n    a.append(bytearray(10**7))" }, runs: [{ stdin: "", timeoutMs: 10_000 }], memoryMb: 128 });
  assert.equal(result.body.runs[0]?.status, "memory");
});

test("a fork bomb is contained", { skip }, async () => {
  const result = await python("import os\nwhile True:\n    try:\n        os.fork()\n    except OSError:\n        pass", 2_000);
  assert.equal(result.body.runs[0]?.status, "timeout");
  // The runner still serves the next request.
  assert.equal((await python("print(1)")).body.runs[0]?.stdout, "1\n");
});

test("the network, the runner's secrets and the entrypoint's process are out of reach", { skip }, async () => {
  const source = [
    "import os, socket",
    "try:\n    socket.create_connection(('1.1.1.1', 53), timeout=2); print('network')\nexcept OSError: print('no-network')",
    "print('secret' if any('must-not-leak' in v for v in os.environ.values()) else 'no-secret')",
    "try:\n    open('/proc/1/environ').read(); print('pid1-readable')\nexcept OSError: print('pid1-closed')",
    "try:\n    os.kill(1, 9); print('pid1-killed')\nexcept OSError: print('pid1-safe')",
    "try:\n    open('/usr/bin/evil', 'w'); print('root-writable')\nexcept OSError: print('root-readonly')",
  ].join("\n");
  const result = await python(source);
  assert.deepEqual(result.body.runs[0]!.stdout.trim().split("\n"), ["no-network", "no-secret", "pid1-closed", "pid1-safe", "root-readonly"]);
});

test("concurrent executions are isolated from one another", { skip }, async () => {
  const write = (tag: string) => python(`import os, time\nopen('/tmp/shared', 'w').write('${tag}')\ntime.sleep(0.5)\nprint(open('/tmp/shared').read(), len(os.listdir('/tmp')))`);
  const results = await Promise.all(["a", "b", "c"].map(write));
  assert.deepEqual(results.map((result) => result.body.runs[0]!.stdout.split(" ")[0]), ["a", "b", "c"]);
});

test("output beyond the limit stops the program", { skip }, async () => {
  const result = await execute({ language: "python", files: { "main.py": "while True:\n    print('x' * 1000)" }, runs: [{ stdin: "", timeoutMs: 5_000 }], stdoutLimit: 10_000 });
  assert.equal(result.body.runs[0]?.status, "output_limit");
  assert.ok(result.body.runs[0]!.stdout.length <= 10_000);
});
