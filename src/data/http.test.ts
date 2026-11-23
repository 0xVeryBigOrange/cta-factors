import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson, fetchText, HttpError, RequestGate, sourceIsDown } from "./http";

afterEach(() => {
  vi.unstubAllGlobals();
});

function gate(): RequestGate {
  return new RequestGate(0);
}

function hang(init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const fail = () => reject(new DOMException("Aborted", "AbortError"));
    if (init?.signal?.aborted) {
      fail();
      return;
    }
    init?.signal?.addEventListener("abort", fail, { once: true });
  });
}

describe("fetch timeouts", () => {
  it("returns json from a source that answers", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await expect(fetchJson("https://example.test/a", { source: "binance", gate: gate(), timeoutMs: 200 })).resolves.toEqual({
      ok: true,
    });
  });

  it("turns one hung attempt into a timeout and does not retry it", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => {
      calls += 1;
      return hang(init);
    });
    const started = Date.now();
    const error = await fetchJson("https://example.test/slow", { source: "okx", gate: gate(), timeoutMs: 40 }).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 0, source: "okx" });
    expect((error as HttpError).message).toContain("超时");
    expect(sourceIsDown(error)).toBe(true);
    expect(calls).toBe(1);
    expect(Date.now() - started).toBeLessThan(400);
  });

  it("lets the caller cancel without marking the source down", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", () => {
      calls += 1;
      return new Promise(() => undefined);
    });
    const controller = new AbortController();
    controller.abort();
    const error = await fetchJson("https://example.test/a", {
      source: "bitget",
      gate: gate(),
      signal: controller.signal,
      timeoutMs: 500,
    }).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(calls).toBe(0);
    expect((error as { name?: string }).name).toBe("AbortError");
    expect(sourceIsDown(error)).toBe(false);
  });

  it("aborts an open request when the caller cancels", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => hang(init));
    const pending = fetchJson("https://example.test/a", {
      source: "coinbase",
      gate: gate(),
      signal: controller.signal,
      timeoutMs: 500,
    });
    setTimeout(() => controller.abort(), 20);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("retries a rate limit once and then reads the body", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      if (calls === 1) return new Response("{}", { status: 429 });
      return new Response(JSON.stringify({ price: 1 }), { status: 200 });
    });
    await expect(fetchJson("https://example.test/a", { source: "kraken", gate: gate(), timeoutMs: 500 })).resolves.toEqual({
      price: 1,
    });
    expect(calls).toBe(2);
  });

  it("times out a text request and still decodes a fast one", async () => {
    vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => hang(init));
    await expect(fetchText("https://example.test/q", { source: "tencent", gate: gate(), timeoutMs: 40 })).rejects.toMatchObject({
      status: 0,
      source: "tencent",
    });
    vi.stubGlobal(
      "fetch",
      async () => new Response("plain", { status: 200, headers: { "content-type": "text/plain" } }),
    );
    await expect(fetchText("https://example.test/q", { source: "tencent", gate: gate(), timeoutMs: 200 })).resolves.toBe("plain");
  });
});
