export interface FeedDef {
  /** Display/log name, e.g. "IGN YouTube" */
  name: string;
  /** Toggle key shared across a brand's feeds, e.g. "IGN". Falls back to `name`. */
  sourceKey?: string;
  category: string;
  /** Every feed is fetched as RSS/Atom (n8n used one RSS Read node for all). */
  type: 'rss';
  url: string;
}

export interface SourceTag {
  name: string;
  category: string;
}

export type FeedKind = 'RSS' | 'YouTube' | 'xCancel';
