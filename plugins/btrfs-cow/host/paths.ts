import path from "node:path";

export const COPIES_DIR_NAME = "copies";

export class CowPathError extends Error {}

const REPO_DIR_NAME_PATTERN = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/;

export function isSinglePathSegment(value: string): boolean {
  return (
    value.length > 0 &&
    value !== "." &&
    value !== ".." &&
    path.basename(value) === value
  );
}

export function deriveRepoDirName(sourcePath: string): string {
  const trimmed = sourcePath.replace(/\/+$/, "");
  const candidate = path.basename(trimmed);
  if (!isSinglePathSegment(candidate) || !REPO_DIR_NAME_PATTERN.test(candidate)) {
    throw new CowPathError(
      `Cannot derive a directory name from source "${sourcePath}"`,
    );
  }
  return candidate;
}

export function resolveCopiesRoot(dataDir: string): string {
  return path.join(dataDir, COPIES_DIR_NAME);
}

export function resolveAttemptRoot(args: {
  dataDir: string;
  pathKey: string;
}): string {
  if (!isSinglePathSegment(args.pathKey)) {
    throw new CowPathError(
      `A copy path key must be a single path segment: ${args.pathKey}`,
    );
  }
  return path.join(resolveCopiesRoot(args.dataDir), args.pathKey);
}

export function resolveTargetPath(args: {
  dataDir: string;
  pathKey: string;
  sourcePath: string;
}): string {
  return path.join(resolveAttemptRoot(args), deriveRepoDirName(args.sourcePath));
}

/** Only paths of the form <dataDir>/copies/<pathKey>/<repo> may be removed. */
export function assertRemovablePath(args: {
  dataDir: string;
  path: string;
}): string {
  const target = path.resolve(args.path);
  const attemptRoot = path.dirname(target);
  const copiesRoot = path.dirname(attemptRoot);
  const removable =
    copiesRoot === path.resolve(resolveCopiesRoot(args.dataDir)) &&
    isSinglePathSegment(path.basename(attemptRoot)) &&
    isSinglePathSegment(path.basename(target));
  if (!removable) {
    throw new CowPathError(
      `Refusing to remove a path outside the copy root: ${args.path}`,
    );
  }
  return target;
}
