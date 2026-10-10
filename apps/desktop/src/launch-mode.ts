export type LaunchMode = { mode: "attach"; url: string } | { mode: "dev" } | { mode: "packaged" };

export function isLoopbackUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1")
    );
  } catch {
    return false;
  }
}

export function classifyLaunchMode(input: {
  attachUrl: string | undefined;
  isPackaged: boolean;
  runtimeDirOverride: string | undefined;
}): LaunchMode {
  if (input.attachUrl !== undefined && input.attachUrl !== "") {
    if (!isLoopbackUrl(input.attachUrl)) {
      throw new Error(
        `LEARNSPACE_DESKTOP_SERVER_URL must be an http(s) loopback URL, got: ${input.attachUrl}`,
      );
    }
    return { mode: "attach", url: input.attachUrl };
  }

  if (input.isPackaged || (input.runtimeDirOverride !== undefined && input.runtimeDirOverride !== "")) {
    return { mode: "packaged" };
  }

  return { mode: "dev" };
}
