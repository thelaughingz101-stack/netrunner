// Port of the n8n "Resolve Youtube Webhook" sub-workflow:
//   Build YT Fetch URL → If Needs Fetch → Fetch YT Page → Extract Channel ID.
// Logic is unchanged; the fetch now has a timeout and a browser-like User-Agent.

export type ResolveResult = { channelId: string; handle: string | null; title?: string | null; avatar?: string | null } | { error: string };

const unescapeHtml = (t: string) => t.replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

export function buildFetchUrl(query: string): { channelId: string } | { fetchUrl: string } | { error: string } {
  const raw = (query || '').trim();
  if (!raw) return { error: 'No query provided' };
  if (/^UC[\w-]{22}$/.test(raw)) return { channelId: raw }; // already a channel ID
  let url = raw;
  if (!/^https?:\/\//i.test(url)) {
    if (!url.startsWith('@') && !url.startsWith('/')) url = '@' + url;
    url = `https://www.youtube.com/${url.replace(/^\/+/, '')}`;
  }
  return { fetchUrl: url };
}

export function extractChannelId(html: string): ResolveResult {
  const idMatch = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/)
    || html.match(/"channelId":"(UC[\w-]{22})"/)
    || html.match(/"externalId":"(UC[\w-]{22})"/);
  if (!idMatch) return { error: "Couldn't find a channel ID on that page. Double-check the URL/handle." };
  const handleMatch = html.match(/"canonicalBaseUrl":"\/(@[\w.-]+)"/);
  // Name + avatar let the UI confirm the right channel without showing the raw UC… id.
  const title = html.match(/<meta property="og:title" content="([^"]*)"/)?.[1];
  const avatar = html.match(/<meta property="og:image" content="([^"]*)"/)?.[1];
  return { channelId: idMatch[1], handle: handleMatch ? handleMatch[1] : null, title: title ? unescapeHtml(title) : null, avatar: avatar ? unescapeHtml(avatar) : null };
}

export async function resolveYoutube(query: string, fetchImpl: typeof fetch = fetch): Promise<ResolveResult> {
  const step = buildFetchUrl(query);
  if ('error' in step) return step;
  if ('channelId' in step) return { channelId: step.channelId, handle: null };
  try {
    const res = await fetchImpl(step.fetchUrl, {
      signal: AbortSignal.timeout(20_000),
      headers: { 'User-Agent': 'Mozilla/5.0 (NetRunner)', 'Accept-Language': 'en-US,en;q=0.9' },
    });
    if (!res.ok) return { error: `YouTube returned HTTP ${res.status} for ${step.fetchUrl}` };
    return extractChannelId(await res.text());
  } catch (e) {
    return { error: `Couldn't fetch ${step.fetchUrl}: ${(e as Error).message}` };
  }
}
