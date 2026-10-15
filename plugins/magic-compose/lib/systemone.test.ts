import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { askChoice, askChoices, JevError } from "./jev";

const question = { instructions: "Pick the project.", options: { notes: "Knowledge notes", media: null } };
const response = { answers: { q0: { type: "choice", choice: "notes", probabilities: { notes: 0.8, media: 0.2 } } } };

describe("self-hosted System One", () => {
  it.each(["local", "selfhosted"] as const)("supports the %s HTTP/1.1 endpoint with mode-specific auth", async provider => {
    let received: unknown;
    let authorization: string | undefined;
    const server = createServer((req, res) => {
      authorization = req.headers.authorization;
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", () => {
        received = JSON.parse(body);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(response));
      });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("No server address");
      const answer = await askChoice({ provider, apiKey: "local-token", model: "local-model",
        baseUrl: `http://127.0.0.1:${address.port}/v1/systemone`, state: { task: "Write a note" }, question });
      expect(authorization).toBe(provider === "local" ? undefined : "Bearer local-token");
      expect(received).toEqual({ model: "local-model", state: { task: "Write a note" }, questions: {
        q0: { type: "choice", instructions: question.instructions, criteria: { notes: "Knowledge notes", media: "" } },
      } });
      expect(answer.choice).toBe("notes");
      expect(answer.confidence).toBeNull();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  it("omits authorization when no token is configured and maps several answers", async () => {
    let headers: HeadersInit | undefined;
    const answers = await askChoices({ provider: "selfhosted", baseUrl: "https://models.example/decide", apiKey: "", model: "m", state: "s",
      questions: { first: question, second: question }, fetchImpl: async (_, init) => {
        headers = init?.headers;
        return new Response(JSON.stringify({ answers: { q0: response.answers.q0, q1: response.answers.q0 } }));
      } });
    expect((headers as Record<string, string>).Authorization).toBeUndefined();
    expect(answers.first?.choice).toBe("notes");
    expect(answers.second?.choice).toBe("notes");
  });

  it.each(["file:///tmp/model", "ftp://server/decide", "http://user:password@server/decide", "invalid"])(
    "rejects invalid or credential-bearing URL %s", async baseUrl => {
      let called = false;
      await expect(askChoice({ provider: "selfhosted", apiKey: "", model: "m", baseUrl, state: "s", question,
        fetchImpl: async () => { called = true; return new Response(JSON.stringify(response)); },
      })).rejects.toBeInstanceOf(JevError);
      expect(called).toBe(false);
    });

  it("reports unavailable local service without switching to a cloud provider", async () => {
    let calls = 0;
    await expect(askChoice({ provider: "selfhosted", baseUrl: "https://models.example/decide", apiKey: "", model: "m", state: "s", question,
      fetchImpl: async () => { calls++; throw new Error("connection refused"); },
    })).rejects.toThrow("Self-hosted server (URL)");
    expect(calls).toBe(2);
  });

  it("identifies local rate limits without naming a cloud gateway", async () => {
    await expect(askChoice({ provider: "selfhosted", baseUrl: "https://models.example/decide", apiKey: "", model: "m", state: "s", question,
      fetchImpl: async () => new Response("{}", { status: 429 }),
    })).rejects.toThrow("Self-hosted server (URL) rate-limited");
  });
});
