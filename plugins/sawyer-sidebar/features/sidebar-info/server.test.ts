import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:os", () => ({ hostname: () => "bee.tailnet.ts.net" }));

const { registerSidebarInfo } = await import("./server.js");

function setup(
  projects: { id: string; gitRemoteUrl: string | null }[],
  hosts: { id: string; name: string }[] = [],
) {
  const host = createFakePluginHost({
    pluginId: "sawyer-sidebar",
    sdk: {
      projects: {
        list: async () =>
          projects.map((project) => ({ ...project, name: project.id })),
      },
      hosts: { list: async () => hosts },
    } as never,
  });
  registerSidebarInfo(host.bb);
  return host;
}

function stubGitHub(owner: { avatar_url: string } | null) {
  const fetchMock = vi.fn(async () =>
    owner === null
      ? new Response("{}", { status: 404 })
      : Response.json({ owner }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sidebar info rpc", () => {
  it("uses the repo's current owner, following a transfer", async () => {
    const fetchMock = stubGitHub({
      avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
    });
    const { harness } = setup([
      { id: "proj_bb", gitRemoteUrl: "git@github.com:ymichael/bb.git" },
      { id: "proj_local", gitRemoteUrl: null },
    ]);
    await expect(harness.behavior.callRpc("sidebarInfo", null)).resolves.toEqual({
      avatars: {
        proj_bb: "https://avatars.githubusercontent.com/u/1?v=4&s=64",
        proj_local: null,
      },
      localHostId: null,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/ymichael/bb",
      expect.anything(),
    );
  });

  it("caches the lookup", async () => {
    const fetchMock = stubGitHub({
      avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
    });
    const { harness } = setup([
      { id: "proj_bb", gitRemoteUrl: "git@github.com:get-bb/bb.git" },
    ]);
    await harness.behavior.callRpc("sidebarInfo", null);
    await harness.behavior.callRpc("sidebarInfo", null);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the remote owner's public avatar when the API fails", async () => {
    stubGitHub(null);
    const { harness } = setup([
      { id: "proj_private", gitRemoteUrl: "git@github.com:SawyerHood/secret.git" },
    ]);
    await expect(harness.behavior.callRpc("sidebarInfo", null)).resolves.toEqual({
      avatars: { proj_private: "https://github.com/SawyerHood.png?size=64" },
      localHostId: null,
    });
  });

  it("finds the machine bb runs on by hostname", async () => {
    stubGitHub(null);
    const { harness } = setup(
      [],
      [
        { id: "host_mac", name: "Sawyer’s MacBook Pro" },
        { id: "host_bee", name: "bee" },
      ],
    );
    await expect(harness.behavior.callRpc("sidebarInfo", null)).resolves.toEqual({
      avatars: {},
      localHostId: "host_bee",
    });
  });
});
