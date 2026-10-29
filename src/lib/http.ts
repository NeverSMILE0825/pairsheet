export class AppError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = "AppError"
    this.status = status
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function fetchJson(url: string, init?: RequestInit, timeout = 25000, attempts = 2): Promise<unknown> {
  let last: Error | null = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          accept: "application/json",
          "user-agent": "PairSheet/1.0",
          ...(init?.headers ?? {}),
        },
        signal: AbortSignal.timeout(timeout),
        cache: "no-store",
      })
      if (response.status === 429 || response.status >= 500) {
        last = new Error(`Upstream responded ${response.status}`)
        await sleep(350 * (attempt + 1))
        continue
      }
      if (!response.ok) {
        const text = await response.text()
        throw new AppError(`Request failed (${response.status}): ${text.slice(0, 160)}`, 502)
      }
      return await response.json()
    } catch (error) {
      if (error instanceof AppError) throw error
      last = error instanceof Error ? error : new Error("Network request failed")
      await sleep(250)
    }
  }
  throw new AppError(last?.message || "Network request failed", 502)
}

export async function mapPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  async function run() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index], index)
    }
  }
  const width = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: width }, () => run()))
  return results
}

type RpcResponse = {
  id?: number
  result?: unknown
  error?: { message?: string }
}

export async function rpcCall(rpcs: string[], method: string, params: unknown[]): Promise<unknown> {
  let last: Error | null = null
  for (const rpc of rpcs) {
    try {
      const body = (await fetchJson(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      })) as RpcResponse
      if (body.error) {
        last = new Error(body.error.message || "RPC error")
        continue
      }
      return body.result
    } catch (error) {
      last = error instanceof Error ? error : new Error("RPC failed")
    }
  }
  throw new AppError(last?.message || "The chain RPC did not respond", 502)
}

export async function rpcBatch(
  rpc: string,
  calls: { method: string; params: unknown[] }[],
): Promise<Map<number, unknown>> {
  const payload = calls.map((call, id) => ({
    jsonrpc: "2.0",
    id,
    method: call.method,
    params: call.params,
  }))
  const response = await fetch(rpc, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": "PairSheet/1.0",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(45000),
    cache: "no-store",
  })
  if (response.status === 429 || response.status >= 500) {
    throw new Error(`RPC batch failed (${response.status})`)
  }
  if (!response.ok) {
    throw new Error(`RPC batch failed (${response.status})`)
  }
  const json = (await response.json()) as RpcResponse | RpcResponse[]
  const rows = Array.isArray(json) ? json : [json]
  const results = new Map<number, unknown>()
  for (const row of rows) {
    if (typeof row.id !== "number") continue
    if (row.error) continue
    if (row.result === undefined || row.result === null) continue
    results.set(row.id, row.result)
  }
  return results
}

/** One JSON-RPC call; returns null when the node has no result for this method. */
export async function rpcSingle(
  rpc: string,
  method: string,
  params: unknown[],
  timeout = 20000,
): Promise<unknown | null> {
  const response = await fetch(rpc, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": "PairSheet/1.0",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeout),
    cache: "no-store",
  })
  if (response.status === 429 || response.status >= 500) {
    throw new Error(`RPC failed (${response.status})`)
  }
  if (!response.ok) throw new Error(`RPC failed (${response.status})`)
  const body = (await response.json()) as RpcResponse
  if (body.error) throw new Error(body.error.message || "RPC error")
  return body.result === undefined ? null : body.result
}
