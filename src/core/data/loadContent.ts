/**
 * loadContent.ts — the async I/O boundary for the data pipeline.
 *
 * This is the only piece that talks to the network (fetch). It pulls the JSON
 * configs at startup, hands the raw values to ContentDatabase (which validates
 * them), and — crucially — NEVER throws: any failed/garbled file is caught and
 * treated as "no data", so the database falls back to safe built-in defaults
 * and the game still boots. The fetcher is injectable so the loader is
 * testable without a real network.
 */
import { ContentDatabase } from "./ContentDatabase";

export type JsonFetcher = (url: string) => Promise<unknown>;

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: HTTP ${res.status}`);
  return res.json();
}

export async function loadContentDatabase(
  baseUrl = "/configs",
  fetcher: JsonFetcher = fetchJson,
): Promise<ContentDatabase> {
  const safe = async (file: string): Promise<unknown> => {
    try {
      return await fetcher(`${baseUrl}/${file}`);
    } catch (err) {
      console.warn(`[content] could not load ${file}; using defaults.`, err);
      return null;
    }
  };

  const [rawEnemies, rawItems, rawHeroes] = await Promise.all([
    safe("enemies.json"),
    safe("items.json"),
    safe("heroes.json"),
  ]);

  return ContentDatabase.fromRaw(rawEnemies, rawItems, rawHeroes);
}
