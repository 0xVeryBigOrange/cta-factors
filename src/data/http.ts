export class HttpError extends Error {
  readonly status: number;
  readonly source: string;

  constructor(message: string, status: number, source: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.source = source;
  }
}

export class RequestGate {
  private chain: Promise<void> = Promise.resolve();
  private nextAt = 0;

  constructor(private readonly gapMs: number) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      const wait = this.nextAt - Date.now();
      if (wait > 0) await sleep(wait);
      this.nextAt = Date.now() + this.gapMs;
      return task();
    });
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

export const gates = {
  binance: new RequestGate(110),
  okx: new RequestGate(150),
  gate: new RequestGate(140),
  bitget: new RequestGate(140),
  kraken: new RequestGate(280),
  coinbase: new RequestGate(180),
  gecko: new RequestGate(1200),
  yahoo: new RequestGate(220),
  tencent: new RequestGate(180),
};

/** Browser calls give up and try the next source after this long. */
export const REQUEST_TIMEOUT_MS = 12_000;

type FetchOptions = {
  source: string;
  gate: RequestGate;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  timeoutMs?: number;
};

type Deadline = {
  signal: AbortSignal;
  dispose: () => void;
  timedOut: () => boolean;
};

function requestDeadline(parent: AbortSignal | undefined, timeoutMs: number): Deadline {
  const controller = new AbortController();
  let didTimeout = false;
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);
  const onParentAbort = () => controller.abort();
  if (parent) {
    if (parent.aborted) controller.abort();
    else parent.addEventListener("abort", onParentAbort);
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
    },
    timedOut: () => didTimeout && !parent?.aborted,
  };
}

function asAbort(error: unknown): DOMException {
  if (error instanceof DOMException && error.name === "AbortError") return error;
  return new DOMException("Aborted", "AbortError");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : !!error && typeof error === "object" && (error as { name?: string }).name === "AbortError";
}

export function sourceIsDown(error: unknown): boolean {
  if (error instanceof HttpError) {
    return error.status === 0 || error.status === 403 || error.status === 418 || error.status === 429 || error.status === 451 || error.status >= 500;
  }
  return !isAbort(error);
}

export async function fetchJson(url: string, options: FetchOptions): Promise<unknown> {
  return options.gate.run(async () => {
    let last: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const deadline = requestDeadline(options.signal, options.timeoutMs ?? REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          signal: deadline.signal,
          headers: { Accept: "application/json", ...options.headers },
        });
        if (response.status === 429 || response.status === 418) {
          last = new HttpError(`${options.source} 频率限制`, response.status, options.source);
          await sleep(800 * (attempt + 1));
          continue;
        }
        if (!response.ok) throw new HttpError(`${options.source} ${response.status}`, response.status, options.source);
        return await response.json();
      } catch (error) {
        if (options.signal?.aborted) throw asAbort(error);
        if (deadline.timedOut()) {
          last = new HttpError(`${options.source} 超时`, 0, options.source);
          break;
        }
        if (error instanceof HttpError && error.status !== 429 && error.status !== 418) throw error;
        if (isAbort(error)) throw error;
        last = error instanceof Error ? error : new Error(String(error));
        await sleep(250);
      } finally {
        deadline.dispose();
      }
    }
    throw last ?? new HttpError(`${options.source} 请求失败`, 0, options.source);
  });
}

export async function fetchText(url: string, options: FetchOptions): Promise<string> {
  return options.gate.run(async () => {
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const deadline = requestDeadline(options.signal, options.timeoutMs ?? REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: deadline.signal, headers: options.headers });
      if (!response.ok) throw new HttpError(`${options.source} ${response.status}`, response.status, options.source);
      const buffer = await response.arrayBuffer();
      const type = response.headers.get("content-type") ?? "";
      const encoding = /gbk|gb2312/i.test(type) ? "gbk" : "utf-8";
      try {
        return new TextDecoder(encoding).decode(buffer);
      } catch {
        return new TextDecoder().decode(buffer);
      }
    } catch (error) {
      if (options.signal?.aborted) throw asAbort(error);
      if (deadline.timedOut()) throw new HttpError(`${options.source} 超时`, 0, options.source);
      throw error;
    } finally {
      deadline.dispose();
    }
  });
}
