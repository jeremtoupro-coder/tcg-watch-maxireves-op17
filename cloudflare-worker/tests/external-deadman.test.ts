import { afterEach, describe, expect, it, vi } from "vitest";
import { pingExternalDeadman, validatedDeadmanUrl } from "../src/externalDeadman";

afterEach(() => vi.unstubAllGlobals());

describe("external dead-man watchdog", () => {
  it("n'accepte que les endpoints HTTPS explicitement autorisés", () => {
    expect(validatedDeadmanUrl("https://hc-ping.com/12345678-1234-1234-1234-123456789abc")).toBeTruthy();
    expect(validatedDeadmanUrl("https://uptime.betterstack.com/api/v1/heartbeat/example")).toBeTruthy();
    expect(validatedDeadmanUrl("http://hc-ping.com/example")).toBeUndefined();
    expect(validatedDeadmanUrl("https://example.com/ping")).toBeUndefined();
    expect(validatedDeadmanUrl("https://user:pass@hc-ping.com/example")).toBeUndefined();
  });

  it("reste désactivé sans endpoint et ne fait aucune requête", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(pingExternalDeadman({}, 1_789_000_000_000)).resolves.toBe("disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ping l'endpoint externe avec le timestamp du Scheduled Event", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.hostname).toBe("hc-ping.com");
      expect(url.searchParams.get("ts")).toBe("1789000000000");
      expect(init?.method).toBe("GET");
      return new Response("ok", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(pingExternalDeadman({
      EXTERNAL_DEADMAN_PING_URL: "https://hc-ping.com/12345678-1234-1234-1234-123456789abc"
    }, 1_789_000_000_000)).resolves.toBe("sent");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ne casse jamais OP Watch si le service externe est indisponible", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    await expect(pingExternalDeadman({
      EXTERNAL_DEADMAN_PING_URL: "https://hc-ping.com/12345678-1234-1234-1234-123456789abc"
    }, Date.now())).resolves.toBe("failed");
  });
});
