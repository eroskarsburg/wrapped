import type { Handlers } from '../main/rpc'

type Client = {
  [K in keyof Handlers]: Handlers[K] extends (first: never, ...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : Handlers[K] extends () => infer R
      ? () => Promise<Awaited<R>>
      : never
}

interface Bridge {
  rpc(name: string, args: unknown[]): Promise<unknown>
  on(channel: string, listener: (...args: any[]) => void): () => void
}

const bridge = (window as unknown as { wrapped: Bridge }).wrapped

export const api = new Proxy({} as Client, {
  get: (_, name: string) => (...args: unknown[]) => bridge.rpc(name, args),
})

export const onEvent = bridge.on
