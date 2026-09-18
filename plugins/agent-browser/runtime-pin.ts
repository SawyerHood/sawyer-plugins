import { chromeAvailable, installChrome } from "./chrome.js";
import {
  currentPlatform,
  installRuntime,
  type InstallOptions,
  type RuntimeRelease,
} from "./installer.js";

export const runtimeRelease: RuntimeRelease = {
  package: "agent-browser",
  version: "0.38.1",
  registry: "https://registry.npmjs.org",
  repository: "vercel-labs/agent-browser",
  commit: "aff6125c023b810ea3f2e5deec5379e9a4270bdc",
  integrity:
    "sha512-k58FCz0yUOCANoNkMiqJe+H2y6r6sUZazqXsWF+MYq1iRC42PjtLcBoag6SSTOD/FRQppvPDvE5HDYEhclvnhw==",
  artifacts: {
    "linux-x64":
      "5100149a1903211c889de4e545bf36d90803740cea4f99aa22651649f9205ea1",
    "linux-arm64":
      "937b315ee0761e8a62f7950ddcfef9b3d3d8e8d5eb9c9d2bf9e23e5725664511",
    "darwin-x64":
      "9187f885f7da0a6d880ff6d2e7dea58e17bea490a1fec85bbb6a36067272ea8e",
    "darwin-arm64":
      "2e61287259053ea964d39e77002c6a34af0e589e55ccff25e659efae7e892e0d",
  },
};

export interface ResolvedRuntime {
  readonly binary: string;
  readonly version: string;
  /** Whether a Chrome that agent-browser can launch was found or installed. */
  readonly chrome: boolean;
}

export async function resolveRuntime(args: {
  dataDir: string;
  signal: AbortSignal;
  /** Local sessions launch Chrome; desktop sessions attach to BB's browser. */
  chrome: boolean;
  release?: RuntimeRelease;
  env?: NodeJS.ProcessEnv;
  onProgress?: InstallOptions["onProgress"];
}): Promise<ResolvedRuntime> {
  const release = args.release ?? runtimeRelease;
  const platform = currentPlatform();
  if (platform === null)
    throw new Error(
      `The agent-browser plugin has no runtime for ${process.platform}-${process.arch}; choose a Linux (glibc) or macOS browser host.`,
    );
  const installed = await installRuntime({
    release,
    dataDir: args.dataDir,
    platform,
    signal: args.signal,
    ...(args.env === undefined ? {} : { env: args.env }),
    ...(args.onProgress === undefined ? {} : { onProgress: args.onProgress }),
  });
  let chrome = await chromeAvailable(args.dataDir, args.env);
  if (args.chrome && !chrome) {
    args.onProgress?.("downloading Chrome for Testing with agent-browser");
    await installChrome(installed.binary, args.signal, args.env);
    chrome = true;
  }
  return { binary: installed.binary, version: release.version, chrome };
}
