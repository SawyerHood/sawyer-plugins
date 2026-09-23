export interface GitHubRemote {
  owner: string;
  repo: string;
}

const GITHUB_REMOTE =
  /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https?:\/\/(?:[^@/]+@)?github\.com\/|git:\/\/github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?\/?$/i;

/** The owner and repo of a GitHub remote URL; null for anything else. */
export function parseGitHubRemote(url: string | null): GitHubRemote | null {
  if (url === null) return null;
  const match = GITHUB_REMOTE.exec(url.trim());
  if (match === null) return null;
  return { owner: match[1], repo: match[2] };
}
