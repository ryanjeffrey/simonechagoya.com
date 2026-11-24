/**
 * Private storage for the studio tools (/studio): sales, expenses, requests and
 * piece costs. It lives in Netlify Blobs (store `studio`), never in this public
 * repo, and only the signed-in studio pages and the form function read or write it.
 *
 * In `astro dev` there is no Netlify Blobs, so a small file store under
 * .netlify/studio-dev stands in, letting the pages be tried locally. It is never
 * used in a production build.
 */
import { getStore } from '@netlify/blobs';

export interface KV {
  getJSON<T>(key: string): Promise<T | null>;
  setJSON(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
}

let kv: KV | null | undefined;

export function studioStore(): KV | null {
  if (kv !== undefined) return kv;
  try {
    const store = getStore({ name: 'studio', consistency: 'strong' });
    kv = {
      getJSON: async <T>(key: string) => (await store.get(key, { type: 'json' })) as T | null,
      setJSON: async (key, value) => {
        await store.setJSON(key, value);
      },
      delete: (key) => store.delete(key),
      keys: async (prefix) => (await store.list({ prefix })).blobs.map((b) => b.key),
    };
  } catch {
    kv = import.meta.env.DEV ? devStore() : null;
  }
  return kv;
}

function devStore(): KV {
  const root = `${process.cwd()}/.netlify/studio-dev`;
  const file = (key: string) => `${root}/${encodeURIComponent(key)}.json`;
  const fs = () => import('node:fs/promises');
  return {
    async getJSON<T>(key: string) {
      try {
        return JSON.parse(await (await fs()).readFile(file(key), 'utf8')) as T;
      } catch {
        return null;
      }
    },
    async setJSON(key, value) {
      const f = await fs();
      await f.mkdir(root, { recursive: true });
      await f.writeFile(file(key), JSON.stringify(value));
    },
    async delete(key) {
      await (await fs()).rm(file(key), { force: true });
    },
    async keys(prefix) {
      const names = await (await fs()).readdir(root).catch(() => [] as string[]);
      return names.map((n) => decodeURIComponent(n.replace(/\.json$/, ''))).filter((k) => k.startsWith(prefix));
    },
  };
}
