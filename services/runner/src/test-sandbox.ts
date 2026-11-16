import Docker from "dockerode";
import { createExecutor, type Execute } from "./executor.js";
import { createSandbox } from "./sandbox.js";

/** A real sandbox for tests, or why the tests that need one are skipped. */
export async function testExecute(): Promise<{ execute: Execute; docker: Docker; image: string; skip: string | false }> {
  const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET ?? "/var/run/docker.sock" });
  const image = process.env.SANDBOX_IMAGE ?? "learnspace-sandbox:1";
  const available = await docker.getImage(image).inspect().then(() => true, () => false);
  const sandbox = createSandbox(docker, { image, runtime: process.env.SANDBOX_RUNTIME || undefined, cpus: 1 });
  return { execute: createExecutor(sandbox.execute, { concurrency: 6, queue: 64 }), docker, image, skip: available ? false : `Docker with the ${image} image is required` };
}
