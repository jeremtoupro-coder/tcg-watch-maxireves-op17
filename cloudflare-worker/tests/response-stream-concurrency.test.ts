import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CalendarCoordinatorDurableObject,
  type RuntimeEnv
} from "../src/durableMonitoring";
import { WebScoutDurableObject } from "../src/webScout";

class MemoryStorage {
  readonly data = new Map<string, unknown>();
  alarm?: number | Date;
  beforePut?: (key: string) => Promise<void>;

  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    if (this.beforePut) await this.beforePut(key);
    this.data.set(key, value);
  }

  async setAlarm(value: number | Date): Promise<void> {
    this.alarm = value;
  }
}

function state(storage: MemoryStorage): DurableObjectState {
  return { storage } as unknown as DurableObjectState;
}

afterEach(() => vi.unstubAllGlobals());

describe("corps HTTP Durable Objects concurrents", () => {
  it("donne une Response calendrier fraîche au cron et au cockpit pendant le même single-flight", async () => {
    let releaseFetch!: () => void;
    const fetchGate = new Promise<void>((resolve) => { releaseFetch = resolve; });
    let fetchEntered!: () => void;
    const entered = new Promise<void>((resolve) => { fetchEntered = resolve; });
    vi.stubGlobal("fetch", vi.fn(async () => {
      fetchEntered();
      await fetchGate;
      return new Response(`
        <html><head><title>PRODUITS | ONE PIECE CARD GAME</title></head><body>
          <h1>PRODUITS ONE PIECE CARD GAME</h1>
          <article>BOOSTER [OP-17] Date de sortie 28 août 2026</article>
          <nav>1 / 1</nav>
        </body></html>
      `, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    }));

    const object = new CalendarCoordinatorDurableObject(state(new MemoryStorage()), {} as RuntimeEnv);
    const input = () => new Request("https://calendar.internal/calendar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scheduledTime: Date.UTC(2026, 7, 15, 10, 0, 0) })
    });
    const first = object.fetch(input());
    await entered;
    const second = object.fetch(input());
    releaseFetch();

    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    expect(firstResponse).not.toBe(secondResponse);
    const [firstBody, secondBody] = await Promise.all([
      firstResponse.json() as Promise<Record<string, any>>,
      secondResponse.json() as Promise<Record<string, any>>
    ]);
    expect(firstBody.activeProducts).toEqual(secondBody.activeProducts);
    expect(firstBody.activeProducts[0].id).toBe("OP-17");
  });

  it("donne aussi une Response Web Scout fraîche à deux lecteurs concurrents", async () => {
    let releasePut!: () => void;
    const putGate = new Promise<void>((resolve) => { releasePut = resolve; });
    let putEntered!: () => void;
    const entered = new Promise<void>((resolve) => { putEntered = resolve; });
    const storage = new MemoryStorage();
    storage.beforePut = async (key) => {
      if (key !== "web-scout:health") return;
      putEntered();
      await putGate;
    };
    const object = new WebScoutDurableObject(state(storage), {
      RUNTIME_TEST_MODE: "true",
      WRITE_STATE: "true"
    });
    const input = () => new Request("https://web-scout.internal/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scheduledTime: Date.UTC(2026, 7, 15, 10, 7, 0) })
    });
    const first = object.fetch(input());
    await entered;
    const second = object.fetch(input());
    releasePut();

    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    expect(firstResponse).not.toBe(secondResponse);
    const [firstBody, secondBody] = await Promise.all([
      firstResponse.json() as Promise<Record<string, any>>,
      secondResponse.json() as Promise<Record<string, any>>
    ]);
    expect(firstBody).toEqual(secondBody);
    expect(firstBody.status).toBe("disabled");
  });
});
