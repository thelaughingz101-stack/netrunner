// "Add your own" → Bluesky accounts: turns a handle or profile link into the account it names, checked against
// Bluesky's public API, so a typo is caught before it's saved. The feed is read by the account's DID (its
// permanent id), so it keeps working if the account changes its handle.

export interface BlueskyAccount { handle: string; did: string; title: string | null; avatar: string | null; lastPost: string | null }
export type BlueskyResult = BlueskyAccount | { error: string };

const API = 'https://public.api.bsky.app/xrpc/';

/** "@name", "name", "name.bsky.social", "some.domain", "did:plc:…" or a bsky.app profile/post link → the actor. */
export function blueskyActor(query: string): string | { error: string } {
  let q = (query || '').trim();
  if (!q) return { error: 'Paste a Bluesky handle or profile link.' };
  const link = q.match(/^(?:https?:\/\/)?(?:www\.)?bsky\.app\/profile\/([^/?#\s]+)/i);
  if (link) q = decodeURIComponent(link[1]);
  q = q.replace(/^@/, '');
  if (/^did:(plc|web):[\w.:%-]+$/i.test(q)) return q;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/i.test(q)) return { error: "That doesn't look like a Bluesky handle (e.g. name.bsky.social)." };
  return q.includes('.') ? q.toLowerCase() : `${q.toLowerCase()}.bsky.social`;
}

export async function resolveBluesky(query: string, fetchImpl: typeof fetch = fetch): Promise<BlueskyResult> {
  const actor = blueskyActor(query);
  if (typeof actor !== 'string') return actor;
  try {
    const res = await fetchImpl(`${API}app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`, { signal: AbortSignal.timeout(15_000) });
    if (res.status === 400 || res.status === 404) return { error: `No Bluesky account called ${actor}.` };
    if (!res.ok) return { error: `Bluesky answered HTTP ${res.status}. Try again in a moment.` };
    const p: any = await res.json();
    if (!p?.did || !p?.handle) return { error: `No Bluesky account called ${actor}.` };
    let lastPost: string | null = null;
    try {
      const f = await fetchImpl(`${API}app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(p.did)}&limit=1&filter=posts_no_replies`, { signal: AbortSignal.timeout(15_000) });
      if (f.ok) lastPost = ((await f.json()) as any)?.feed?.[0]?.post?.indexedAt ?? null;
    } catch { /* the account is fine; just no date to show */ }
    return { handle: p.handle, did: p.did, title: p.displayName || null, avatar: p.avatar || null, lastPost };
  } catch (e) {
    return { error: `Couldn't reach Bluesky: ${(e as Error).message}` };
  }
}
