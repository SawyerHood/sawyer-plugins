import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import {
  access,
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { delimiter, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

export const runtimePlatforms = [
  "linux-x64",
  "linux-arm64",
  "darwin-x64",
  "darwin-arm64",
] as const;
export type RuntimePlatform = (typeof runtimePlatforms)[number];
const platformSchema = z.enum(runtimePlatforms);

export interface RuntimeRelease {
  readonly package: string;
  readonly version: string;
  readonly registry: string;
  readonly repository: string;
  /** Git commit the provenance attestation must name as its build source. */
  readonly commit: string;
  /** npm `dist.integrity` of the tarball, which carries every platform binary. */
  readonly integrity: string;
  /** SHA-256 of each platform's binary inside that tarball. */
  readonly artifacts: Readonly<Partial<Record<RuntimePlatform, string>>>;
}

export interface InstalledRuntime {
  readonly binary: string;
  readonly version: string;
  readonly sha256: string;
}

export interface InstallOptions {
  readonly release: RuntimeRelease;
  readonly dataDir: string;
  readonly platform: RuntimePlatform;
  readonly signal: AbortSignal;
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchAttestations?: (url: string, signal: AbortSignal) => Promise<string>;
  readonly onProgress?: (detail: string) => void;
}

export function currentPlatform(): RuntimePlatform | null {
  const parsed = platformSchema.safeParse(
    `${process.platform}-${process.arch}`,
  );
  return parsed.success ? parsed.data : null;
}

const verifiedSchema = z
  .object({
    package: z.string(),
    version: z.string(),
    platform: platformSchema,
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    binary: z.string(),
    installedAt: z.number().int(),
  })
  .strict();

const lockStaleMs = 20 * 60_000;

export function installRoot(dataDir: string): string {
  return join(dataDir, "runtime", "npm");
}

function installDir(dataDir: string, release: RuntimeRelease): string {
  return join(installRoot(dataDir), `${release.package}@${release.version}`);
}

export function binaryPath(
  release: RuntimeRelease,
  platform: RuntimePlatform,
): string {
  return `node_modules/${release.package}/bin/${release.package}-${platform}`;
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function verifyInstalled(
  release: RuntimeRelease,
  dataDir: string,
  platform: RuntimePlatform,
): Promise<InstalledRuntime | null> {
  const expected = release.artifacts[platform];
  if (expected === undefined) return null;
  const dir = installDir(dataDir, release);
  let record: z.infer<typeof verifiedSchema>;
  try {
    record = verifiedSchema.parse(
      JSON.parse(await readFile(join(dir, "verified.json"), "utf8")),
    );
  } catch {
    return null;
  }
  if (
    record.package !== release.package ||
    record.version !== release.version ||
    record.platform !== platform ||
    record.sha256 !== expected ||
    record.binary.split("/").some((part) => part === "..")
  )
    return null;
  const binary = join(dir, record.binary);
  try {
    await access(binary, constants.X_OK);
  } catch {
    return null;
  }
  if ((await sha256File(binary)) !== expected) return null;
  return { binary, version: release.version, sha256: expected };
}

function installEnvironment(
  base: NodeJS.ProcessEnv,
  cache: string,
  registry: string,
) {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH",
    "HOME",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "SSL_CERT_FILE",
    "NODE_EXTRA_CA_CERTS",
  ]) {
    if (base[key]) env[key] = base[key];
  }
  env.npm_config_cache = cache;
  env.npm_config_registry = registry;
  env.npm_config_update_notifier = "false";
  env.npm_config_progress = "false";
  env.npm_config_color = "false";
  env.npm_config_ignore_scripts = "true";
  env.npm_config_audit = "false";
  env.npm_config_fund = "false";
  env.npm_config_loglevel = "error";
  return env;
}

export async function findNpm(env: NodeJS.ProcessEnv): Promise<string> {
  for (const dir of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const candidate = join(dir, "npm");
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error(
    "npm is not available on this browser host's PATH; install Node.js with npm on the selected host so agent-browser can be installed there.",
  );
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let aborted = false;
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    const abort = () => {
      aborted = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    };
    deadline.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < 4_000_000) stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 64_000) stderr += chunk;
    });
    child.once("error", (error) => {
      deadline.removeEventListener("abort", abort);
      reject(error);
    });
    child.once("close", (code) => {
      deadline.removeEventListener("abort", abort);
      if (aborted)
        reject(
          signal.aborted
            ? new Error("agent-browser installation was cancelled")
            : new Error(
                `${command} ${args[0]} timed out after ${timeoutMs} ms`,
              ),
        );
      else resolve({ code, stdout, stderr });
    });
  });
}

function tail(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 1_500 ? `…${trimmed.slice(-1_500)}` : trimmed;
}

const signaturesSchema = z
  .object({
    invalid: z.array(z.unknown()),
    missing: z.array(z.unknown()),
  })
  .loose();
const installedLockSchema = z
  .object({
    packages: z.record(
      z.string(),
      z
        .object({
          version: z.string(),
          resolved: z.string(),
          integrity: z.string(),
        })
        .loose(),
    ),
  })
  .loose();
const attestationsSchema = z
  .object({
    attestations: z.array(
      z
        .object({
          predicateType: z.string(),
          bundle: z
            .object({
              dsseEnvelope: z.object({ payload: z.string() }).loose(),
            })
            .loose(),
        })
        .loose(),
    ),
  })
  .loose();
const provenanceSchema = z
  .object({
    subject: z
      .array(
        z
          .object({
            name: z.string(),
            digest: z.object({ sha512: z.string() }).loose(),
          })
          .loose(),
      )
      .min(1),
    predicate: z
      .object({
        buildDefinition: z
          .object({
            externalParameters: z
              .object({
                workflow: z.object({ repository: z.string() }).loose(),
              })
              .loose(),
            resolvedDependencies: z.array(
              z
                .object({
                  digest: z.object({ gitCommit: z.string() }).partial().loose(),
                })
                .loose(),
            ),
          })
          .loose(),
      })
      .loose(),
  })
  .loose();

export function checkSignatures(
  report: unknown,
  release: RuntimeRelease,
): void {
  const parsed = signaturesSchema.safeParse(report);
  if (!parsed.success)
    throw new Error(
      "npm audit signatures returned an unexpected report; npm 9.5 or newer is required on the browser host.",
    );
  if (parsed.data.invalid.length > 0 || parsed.data.missing.length > 0)
    throw new Error(
      `npm could not verify the registry signature or attestation of ${release.package}@${release.version}; refusing to install it.`,
    );
}

export function integrityToHex(integrity: string): string {
  const match = integrity.match(/^sha512-([A-Za-z0-9+/=]+)$/);
  if (!match)
    throw new Error("Installed package integrity is not a sha512 digest");
  return Buffer.from(match[1]!, "base64").toString("hex");
}

export function checkProvenance(
  document: unknown,
  release: RuntimeRelease,
  integrity: string,
): void {
  const parsed = attestationsSchema.safeParse(document);
  if (!parsed.success)
    throw new Error(
      `The registry returned no attestations for ${release.package}@${release.version}; refusing to install it.`,
    );
  const attestation = parsed.data.attestations.find(
    (item) => item.predicateType === "https://slsa.dev/provenance/v1",
  );
  if (!attestation)
    throw new Error(
      `${release.package}@${release.version} has no SLSA provenance attestation on the registry; refusing to install it.`,
    );
  const statement = provenanceSchema.parse(
    JSON.parse(
      Buffer.from(attestation.bundle.dsseEnvelope.payload, "base64").toString(
        "utf8",
      ),
    ),
  );
  const definition = statement.predicate.buildDefinition;
  const workflow = definition.externalParameters.workflow;
  const subject = `pkg:npm/${release.package}@${release.version}`;
  const digest = integrityToHex(integrity);
  if (
    !statement.subject.some(
      (item) => item.name === subject && item.digest.sha512 === digest,
    )
  )
    throw new Error(
      `${release.package}@${release.version} provenance does not cover the installed tarball; refusing to install it.`,
    );
  const commits = definition.resolvedDependencies.map(
    (item) => item.digest.gitCommit,
  );
  if (
    workflow.repository !== `https://github.com/${release.repository}` ||
    !commits.includes(release.commit)
  )
    throw new Error(
      `${release.package}@${release.version} provenance names ${workflow.repository} at ${commits.filter(Boolean).join(", ") || "no commit"}, not ${release.repository} at ${release.commit}; refusing to install it.`,
    );
}

async function fetchText(url: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, {
    signal,
    redirect: "follow",
    headers: { "user-agent": "bb-plugin-agent-browser" },
  });
  if (!response.ok)
    throw new Error(`HTTP ${response.status} while downloading ${url}`);
  const text = await response.text();
  if (text.length > 1_000_000) throw new Error(`${url} is unexpectedly large`);
  return text;
}

const lockInitGraceMs = 10_000;

async function lockOwner(path: string): Promise<number | null> {
  const match = (await readFile(path, "utf8")).trim().match(/^([0-9]+)(?: |$)/);
  return match ? Number(match[1]) : null;
}

export async function acquireLock(
  path: string,
  signal: AbortSignal,
): Promise<() => Promise<void>> {
  const token = randomBytes(8).toString("hex");
  const claim = `${path}.claim-${process.pid}-${token}`;
  const content = `${process.pid} ${token}`;
  while (true) {
    signal.throwIfAborted();
    await writeFile(claim, content);
    try {
      await link(claim, path);
      const acquired = (await stat(claim, { bigint: true })).ino;
      await unlink(claim);
      return async () => {
        try {
          if (
            (await stat(path, { bigint: true })).ino === acquired &&
            (await readFile(path, "utf8")) === content
          )
            await unlink(path);
        } catch {}
      };
    } catch (error) {
      await unlink(claim).catch(() => {});
      if (
        !(error instanceof Error && "code" in error && error.code === "EEXIST")
      )
        throw error;
    }
    let stale = false;
    let holder: number | null = null;
    let seen: { ino: bigint; mtimeMs: number } | null = null;
    try {
      const info = await stat(path, { bigint: true });
      seen = { ino: info.ino, mtimeMs: Number(info.mtimeMs) };
      const age = Date.now() - seen.mtimeMs;
      holder = await lockOwner(path);
      if (age > lockStaleMs) stale = true;
      else if (holder === null) stale = age > lockInitGraceMs;
      else if (holder !== process.pid) {
        try {
          process.kill(holder, 0);
        } catch (probe) {
          if (
            probe instanceof Error &&
            "code" in probe &&
            probe.code === "ESRCH"
          )
            stale = true;
        }
      }
    } catch {
      continue;
    }
    if (stale && seen) {
      try {
        const current = await stat(path, { bigint: true });
        if (
          current.ino === seen.ino &&
          Number(current.mtimeMs) === seen.mtimeMs &&
          (await lockOwner(path)) === holder
        )
          await unlink(path);
      } catch {}
    } else await delay(250, undefined, { signal });
  }
}

function stagingPrefix(release: RuntimeRelease): string {
  return `.staging-${release.package}@${release.version}-`;
}

async function sweepStaging(
  root: string,
  release: RuntimeRelease,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter((entry) => entry.startsWith(stagingPrefix(release)))
      .map((entry) => rm(join(root, entry), { recursive: true, force: true })),
  );
}

export async function installRuntime(
  options: InstallOptions,
): Promise<InstalledRuntime> {
  const { release, dataDir, platform, signal } = options;
  let lastDetail = "";
  const progress = (detail: string) => {
    if (detail === lastDetail) return;
    lastDetail = detail;
    options.onProgress?.(detail);
  };
  const expected = release.artifacts[platform];
  if (expected === undefined)
    throw new Error(
      `agent-browser ${release.version} has no verified binary recorded for ${platform}; see the plugin README before using this host.`,
    );
  const cached = await verifyInstalled(release, dataDir, platform);
  if (cached) return cached;
  const root = installRoot(dataDir);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const finalDir = installDir(dataDir, release);
  const unlock = await acquireLock(`${finalDir}.lock`, signal);
  try {
    const raced = await verifyInstalled(release, dataDir, platform);
    if (raced) return raced;
    await rm(finalDir, { recursive: true, force: true });
    await sweepStaging(root, release);
    const env = installEnvironment(
      options.env ?? process.env,
      join(root, "cache"),
      release.registry,
    );
    progress("locating npm on the browser host");
    const npm = await findNpm(env);
    const staging = await mkdtemp(join(root, stagingPrefix(release)));
    try {
      await writeFile(
        join(staging, "package.json"),
        JSON.stringify(
          {
            name: "bb-agent-browser-runtime",
            private: true,
            dependencies: { [release.package]: release.version },
          },
          null,
          2,
        ),
      );
      progress(`installing ${release.package}@${release.version} with npm`);
      const install = await runCommand(
        npm,
        [
          "install",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          "--omit=dev",
          "--loglevel=error",
          `--registry=${release.registry}`,
        ],
        staging,
        env,
        signal,
        10 * 60_000,
      );
      if (install.code !== 0)
        throw new Error(
          `npm install of ${release.package}@${release.version} failed on the browser host (exit ${install.code}). ${tail(install.stderr || install.stdout)}`,
        );
      progress("verifying npm registry signature and provenance");
      const audit = await runCommand(
        npm,
        ["audit", "signatures", "--json", `--registry=${release.registry}`],
        staging,
        env,
        signal,
        2 * 60_000,
      );
      let report: unknown;
      try {
        report = JSON.parse(audit.stdout);
      } catch {
        throw new Error(
          `npm audit signatures did not produce a report on the browser host (exit ${audit.code}). ${tail(audit.stderr)}`,
        );
      }
      if (audit.code !== 0)
        throw new Error(
          `npm audit signatures failed on the browser host (exit ${audit.code}) for ${release.package}@${release.version}. ${tail(audit.stderr || audit.stdout)}`,
        );
      checkSignatures(report, release);
      const lock = installedLockSchema.parse(
        JSON.parse(
          await readFile(
            join(staging, "node_modules", ".package-lock.json"),
            "utf8",
          ),
        ),
      );
      const installedEntry = lock.packages[`node_modules/${release.package}`];
      if (!installedEntry || installedEntry.version !== release.version)
        throw new Error(
          `npm installed ${installedEntry?.version ?? "nothing"} instead of ${release.package}@${release.version}.`,
        );
      if (!installedEntry.resolved.startsWith(`${release.registry}/`))
        throw new Error(
          `npm resolved ${release.package} from ${installedEntry.resolved}, not the pinned registry ${release.registry}.`,
        );
      if (installedEntry.integrity !== release.integrity)
        throw new Error(
          `npm installed a ${release.package}@${release.version} tarball with integrity ${installedEntry.integrity}, not the pinned ${release.integrity}; refusing to use it.`,
        );
      checkProvenance(
        JSON.parse(
          await (options.fetchAttestations ?? fetchText)(
            `${release.registry}/-/npm/v1/attestations/${release.package}@${release.version}`,
            signal,
          ),
        ),
        release,
        installedEntry.integrity,
      );
      const packageDir = join(staging, "node_modules", release.package);
      const manifest = z
        .object({ name: z.string(), version: z.string() })
        .loose()
        .parse(
          JSON.parse(await readFile(join(packageDir, "package.json"), "utf8")),
        );
      if (
        manifest.name !== release.package ||
        manifest.version !== release.version
      )
        throw new Error(
          `Installed package is ${manifest.name}@${manifest.version}, not ${release.package}@${release.version}.`,
        );
      const relativeBinary = binaryPath(release, platform);
      const binary = join(staging, relativeBinary);
      const digest = await sha256File(binary).catch(() => null);
      if (digest !== expected)
        throw new Error(
          `${release.package}@${release.version} ships a ${platform} binary with digest ${digest ?? "absent"}, not the pinned ${expected}; refusing to use it.`,
        );
      await chmod(binary, 0o755);
      progress("checking the installed binary");
      const probe = await runCommand(
        binary,
        ["--version"],
        staging,
        env,
        signal,
        60_000,
      );
      if (probe.code !== 0 || !probe.stdout.includes(release.version))
        throw new Error(
          `The ${platform} binary did not report version ${release.version} on this host (exit ${probe.code}). ${tail(probe.stderr || probe.stdout)}`,
        );
      await writeFile(
        join(staging, "verified.json"),
        JSON.stringify(
          verifiedSchema.parse({
            package: release.package,
            version: release.version,
            platform,
            sha256: expected,
            binary: relativeBinary,
            installedAt: Date.now(),
          }),
          null,
          2,
        ),
      );
      await rename(staging, finalDir);
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
    const installed = await verifyInstalled(release, dataDir, platform);
    if (!installed)
      throw new Error("agent-browser failed verification after install");
    return installed;
  } finally {
    await unlock();
  }
}
