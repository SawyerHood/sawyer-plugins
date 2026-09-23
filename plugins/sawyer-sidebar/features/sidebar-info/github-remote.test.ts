import { describe, expect, it } from "vitest";
import { parseGitHubRemote } from "./github-remote.js";

describe("parseGitHubRemote", () => {
  it.each([
    ["git@github.com:ymichael/bb.git", "ymichael", "bb"],
    ["https://github.com/SawyerHood/games.git", "SawyerHood", "games"],
    ["https://github.com/get-bb/bb", "get-bb", "bb"],
    ["ssh://git@github.com/get-bb/bb.git", "get-bb", "bb"],
    ["https://token@github.com/get-bb/bb.git/", "get-bb", "bb"],
  ])("reads %s", (url, owner, repo) => {
    expect(parseGitHubRemote(url)).toEqual({ owner, repo });
  });

  it.each([null, "", "git@gitlab.com:group/repo.git", "/srv/git/repo.git"])(
    "ignores %s",
    (url) => {
      expect(parseGitHubRemote(url)).toBeNull();
    },
  );
});
