import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { parseGitHubRemote } from "./github-remote.js";

export const repoAvatarsRpcContract = defineRpcContract({
  repoAvatars: {
    input: z.null(),
    output: z
      .object({ avatars: z.record(z.string(), z.string().nullable()) })
      .strict(),
  },
});

const CACHE_PREFIX = "repo-avatar:";
/** A resolved owner rarely changes; recheck weekly. */
const RESOLVED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** A failed lookup (private repo, rate limit, offline) retries sooner. */
const FALLBACK_TTL_MS = 6 * 60 * 60 * 1000;
const AVATAR_SIZE = 64;

interface CachedAvatar {
  url: string;
  fetchedAt: number;
  resolved: boolean;
}

function sizedAvatarUrl(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("s", String(AVATAR_SIZE));
  return parsed.toString();
}

/**
 * Ask GitHub who owns the repo now. A transferred repo keeps redirecting from
 * its old path, and the API answers with the current owner, so a remote that
 * still says `ymichael/bb` shows the `get-bb` avatar.
 */
async function fetchOwnerAvatar(owner: string, repo: string): Promise<string | null> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "bb-plugin-sawyer-sidebar",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { owner?: { avatar_url?: unknown } };
  const avatarUrl = body.owner?.avatar_url;
  return typeof avatarUrl === "string" ? sizedAvatarUrl(avatarUrl) : null;
}

export function registerRepoAvatars(bb: BbPluginApi): void {
  const inFlight = new Map<string, Promise<string>>();

  async function avatarFor(owner: string, repo: string): Promise<string> {
    const key = `${CACHE_PREFIX}${owner}/${repo}`.toLowerCase();
    const cached = await bb.storage.kv.get<CachedAvatar>(key);
    const ttl = cached?.resolved ? RESOLVED_TTL_MS : FALLBACK_TTL_MS;
    if (cached && Date.now() - cached.fetchedAt < ttl) return cached.url;

    const pending = inFlight.get(key);
    if (pending) return pending;
    const lookup = (async () => {
      let resolvedUrl: string | null = null;
      try {
        resolvedUrl = await fetchOwnerAvatar(owner, repo);
      } catch {
        resolvedUrl = null;
      }
      // Without the API (private repo, rate limit), the remote's owner still
      // has a public avatar at github.com/<owner>.png.
      const url =
        resolvedUrl ??
        cached?.url ??
        `https://github.com/${owner}.png?size=${AVATAR_SIZE}`;
      const entry: CachedAvatar = {
        url,
        fetchedAt: Date.now(),
        resolved: resolvedUrl !== null,
      };
      await bb.storage.kv.set(key, entry);
      return url;
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, lookup);
    return lookup;
  }

  bb.rpc.register(repoAvatarsRpcContract, {
    async repoAvatars() {
      const projects = await bb.sdk.projects.list();
      const entries = await Promise.all(
        projects.map(async (project) => {
          const remote = parseGitHubRemote(project.gitRemoteUrl);
          if (remote === null) return [project.id, null] as const;
          return [project.id, await avatarFor(remote.owner, remote.repo)] as const;
        }),
      );
      return { avatars: Object.fromEntries(entries) };
    },
  });
}
