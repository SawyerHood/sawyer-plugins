import { describe, expect, it, vi } from "vitest";
import {
  buildDiscordPrompt,
  createDiscordClient,
  snowflakeTime,
} from "./discord";

const guild = "100000000000000001";
const channel = "100000000000000002";
const epoch = Date.UTC(2026, 8, 5);
const id = (offset: number) =>
  (BigInt(epoch + offset - 1420070400000) << 22n).toString();
const message = (offset: number, bot = false) => ({
  id: id(offset),
  content: `Report ${offset}`,
  type: 0,
  author: { id: guild, username: "reporter", bot },
  attachments: [],
});
function client(routes: (path: string) => unknown) {
  const request = vi.fn(async (url: string | URL | Request) =>
    Response.json(
      routes(String(url).replace("https://discord.com/api/v10", "")),
    ),
  );
  return {
    api: createDiscordClient("test-token", undefined, request),
    request,
  };
}

describe("Discord intake", () => {
  it("paginates text messages, ignores bots and backlog, and preserves snowflake precision", async () => {
    const { api, request } = client((path) => {
      if (path === `/channels/${channel}`)
        return { id: channel, type: 0, guild_id: guild };
      if (path.includes("before=")) return [message(-1)];
      return Array.from({ length: 100 }, (_, index) =>
        message(index, index === 50),
      ).reverse();
    });
    const posts = await api.listPosts(channel, epoch);
    expect(posts).toHaveLength(99);
    expect(posts[0].id).toBe(id(0));
    expect(posts.at(-1)?.createdAt).toBe(epoch + 99);
    expect(request).toHaveBeenCalledTimes(3);
    expect(snowflakeTime(id(99))).toBe(epoch + 99);
  });

  it("collects active and archived forum posts once, excluding other forums and old posts", async () => {
    const thread = (offset: number, parent = channel) => ({
      id: id(offset),
      type: 11,
      name: "Bug report",
      parent_id: parent,
      thread_metadata: {
        archive_timestamp: new Date(epoch + offset).toISOString(),
      },
    });
    const { api } = client((path) => {
      if (path === `/channels/${channel}`)
        return { id: channel, type: 15, guild_id: guild };
      if (path.includes("/threads/active"))
        return { threads: [thread(1), thread(-10), thread(3, guild)] };
      if (path.includes("/archived/public"))
        return { threads: [thread(1), thread(2)], has_more: false };
      if (path === `/channels/${id(1)}/messages/${id(1)}`) return message(1);
      if (path === `/channels/${id(2)}/messages/${id(2)}`) return message(2);
      throw new Error(`Unexpected request: ${path}`);
    });
    const posts = await api.listPosts(channel, epoch);
    expect(posts.map((post) => post.id)).toEqual([id(1), id(2)]);
    expect(posts[0].title).toBe("Bug report");
    expect(posts[0].url).toBe(
      `https://discord.com/channels/${guild}/${id(1)}/${id(1)}`,
    );
  });

  it("fails visibly when content access is missing, preserving the caller's cursor", async () => {
    const { api } = client((path) =>
      path === `/channels/${channel}`
        ? { id: channel, type: 0, guild_id: guild }
        : [{ ...message(1), content: "" }],
    );
    await expect(api.listPosts(channel, epoch)).rejects.toThrow(
      "Message Content Intent",
    );
  });

  it("respects Discord's retry interval without exposing its token", async () => {
    const request = vi.fn(async () =>
      Response.json({ retry_after: 60 }, { status: 429 }),
    );
    const api = createDiscordClient("do-not-log", undefined, request);
    await expect(api.listPosts(channel, epoch)).rejects.toThrow("rate limited");
    await expect(api.listPosts(channel, epoch)).rejects.toThrow("rate limited");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("provides generic instructions and configured GitHub identity without a posting contract", async () => {
    const { api } = client((path) =>
      path === `/channels/${channel}`
        ? { id: channel, type: 0, guild_id: guild }
        : [message(1)],
    );
    const [post] = await api.listPosts(channel, epoch);
    const rule = {
      name: "intake",
      mode: "live",
      repo: "",
      prompt: "Summarize this report.",
    };
    const prompt = buildDiscordPrompt(rule, post, "~/.slopcop/slopcop-gh");
    expect(prompt).toContain(rule.prompt);
    expect(prompt).toContain("~/.slopcop/slopcop-gh");
    expect(prompt).toContain(post.url);
    expect(prompt).toContain("UNTRUSTED DATA");
    expect(prompt).not.toContain("issue comment");
    expect(prompt).not.toContain("<!-- slopcop:");
    expect(
      buildDiscordPrompt({ ...rule, mode: "shadow" }, post, "gh"),
    ).toContain("Do not write to GitHub, Discord, or any external service");
  });
});
