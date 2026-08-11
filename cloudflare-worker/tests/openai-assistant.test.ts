import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultRuntimeControlConfig, normalizeRuntimeControlConfig } from "../src/controlPlane";
import {
  DEFAULT_OPENAI_MODEL,
  extractOpenAiAssistantResult,
  requestOpenAiAssistant
} from "../src/openaiAssistant";

const snapshot = {
  checkedAt: "2026-08-11T18:30:00.000Z",
  runtime: { live: true },
  totals: { green: 20, amber: 3, red: 1, gray: 0 },
  stores: [{ key: "joueclub", name: "JouéClub", level: "green" }],
  calendar: { activeProducts: [{ id: "OP-17" }] },
  control: {
    languages: ["Français confirmé"],
    manualProducts: [],
    productOverrides: {}
  }
};

afterEach(() => vi.unstubAllGlobals());

describe("cockpit OpenAI assistant", () => {
  it("extrait le texte, le modèle, l'usage et les citations web d'une Response", () => {
    const result = extractOpenAiAssistantResult({
      id: "resp_test",
      model: "gpt-5.2-2026-08-01",
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: "JouéClub est opérationnel.",
          annotations: [
            { type: "url_citation", title: "JouéClub", url: "https://www.joueclub.fr/" },
            { type: "url_citation", title: "JouéClub duplicate", url: "https://www.joueclub.fr/" }
          ]
        }]
      }],
      usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150 }
    });

    expect(result).toMatchObject({
      responseId: "resp_test",
      model: "gpt-5.2-2026-08-01",
      answer: "JouéClub est opérationnel.",
      usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 }
    });
    expect(result.sources).toEqual([{ title: "JouéClub", url: "https://www.joueclub.fr/" }]);
  });

  it("appelle Responses API côté serveur avec store=false et recherche web", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.openai.com/v1/responses");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sk-server-only-test");
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe(DEFAULT_OPENAI_MODEL);
      expect(body.store).toBe(false);
      expect(body.tools).toEqual([{ type: "web_search" }]);
      expect(body.instructions).toContain("assistant technique intégré au cockpit privé OP Watch");
      expect(body.instructions).toContain("OP-17");
      expect(body.input.at(-1)).toEqual({ role: "user", content: "Pourquoi JouéClub est vert ?" });
      expect(JSON.stringify(body)).not.toContain("sk-server-only-test");
      return new Response(JSON.stringify({
        id: "resp_live",
        model: DEFAULT_OPENAI_MODEL,
        output: [{ type: "message", content: [{ type: "output_text", text: "Parce que son dernier cycle est sain.", annotations: [] }] }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestOpenAiAssistant(
      { OPENAI_API_KEY: "sk-server-only-test" },
      "Pourquoi JouéClub est vert ?",
      snapshot,
      []
    );
    expect(result.answer).toContain("dernier cycle");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("préserve un historique assistant enrichi dans le control plane", () => {
    const base = defaultRuntimeControlConfig(new Date("2026-08-11T18:30:00Z"));
    const normalized = normalizeRuntimeControlConfig({
      ...base,
      assistantRequests: [{
        id: "req-1",
        createdAt: "2026-08-11T18:30:00Z",
        completedAt: "2026-08-11T18:30:04Z",
        text: "État ?",
        status: "done",
        answer: "Tout va bien.",
        model: "gpt-5.2",
        responseId: "resp-1",
        sources: [{ title: "Bandai", url: "https://fr.onepiece-cardgame.com/products/" }],
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
      }]
    });
    expect(normalized.assistantRequests[0]).toMatchObject({
      status: "done",
      answer: "Tout va bien.",
      model: "gpt-5.2",
      responseId: "resp-1",
      usage: { totalTokens: 15 }
    });
    expect(normalized.assistantRequests[0].sources).toHaveLength(1);
  });
});
