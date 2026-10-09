import type { FeedDef } from './types.js';

// Add NEW built-in sources here (feeds.generated.ts is a verbatim copy of the n8n node).
// Each entry also needs a matching SOURCE_MAP / YOUTUBE_AUTHORS entry in
// sourceMap.extra.ts so Normalize & Tag can tag its items (see README → "Adding a source").
// Every URL below was fetched and returned recent items on 2026-10-08.

/**
 * Fixes for generated feeds that died, keyed by feed name. A partial patches the feed (name, and so
 * its Sources toggle, stays the same); null removes it.
 */
export const FEED_OVERRIDES: Record<string, Partial<FeedDef> | null> = {
  // Wrong/retired YouTube channel IDs (404).
  'CNETTV YouTube':           { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCOmcA3f_RrH6b9NmcNa4tdg' },
  'Unbox Therapy YouTube':    { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCsTcErHg8oDvUnTzoqsYeNw' },
  'Bloomberg YouTube':        { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCIALMKvObZNtJ6AmdCLP7Lg' }, // Bloomberg Television
  'Business Insider YouTube': { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCcyq283he07B7_KUX07mmtA' },
  // Moved feeds (404).
  'Billboard':     { url: 'https://www.billboard.com/feed/' },
  'Google Trends': { url: 'https://trends.google.com/trending/rss?geo=US' },
  // Its replacement feeds are aggregators linking to other publishers (USA Today, CNN…), which would
  // land untagged in Custom Feeds. AP / Reuters / NYT already cover the same ground.
  'Yahoo News':    null,
  // The allinurl: Google News queries came back empty; site: queries work.
  'AP News':       { url: 'https://news.google.com/rss/search?q=site:apnews.com+when:1d&hl=en-US&gl=US&ceid=US:en' },
  'Reuters':       { url: 'https://news.google.com/rss/search?q=site:reuters.com+when:1d&hl=en-US&gl=US&ceid=US:en' },
  // 429 on every request; replaced by The Decoder / MIT Technology Review below.
  'VentureBeat AI': null,
};

const yt = (id: string) => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
const gh = (repo: string) => `https://github.com/${repo}/releases.atom`;

export const EXTRA_FEEDS: FeedDef[] = [
  // 🎞️ ANIMATION — had no sources once xCancel stopped being fetched
  { name: 'Cartoon Brew',        category: 'Animation', type: 'rss', url: 'https://www.cartoonbrew.com/feed' },
  { name: 'Animation Magazine',  category: 'Animation', type: 'rss', url: 'https://www.animationmagazine.net/feed/' },
  { name: 'AWN',                 category: 'Animation', type: 'rss', url: 'https://www.awn.com/rss.xml' },
  { name: 'Skwigly',             category: 'Animation', type: 'rss', url: 'https://www.skwigly.co.uk/feed/' },
  { name: 'Animation Scoop',     category: 'Animation', type: 'rss', url: 'https://www.animationscoop.com/feed/' },
  { name: 'Animation Obsessive', category: 'Animation', type: 'rss', url: 'https://animationobsessive.substack.com/feed' },

  // 💼 BUSINESS & FINANCE
  { name: 'CNBC',             category: 'Business & Finance', type: 'rss', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114' },
  { name: 'MarketWatch',      category: 'Business & Finance', type: 'rss', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
  { name: 'Financial Times',  category: 'Business & Finance', type: 'rss', url: 'https://www.ft.com/rss/home' },
  { name: 'Fortune',          category: 'Business & Finance', type: 'rss', url: 'https://fortune.com/feed/' },
  { name: 'Bloomberg Originals YouTube', sourceKey: 'Bloomberg', category: 'Business & Finance', type: 'rss', url: yt('UCUMZ7gohGI9HcU9VNsr2FJQ') },

  // 🌍 WORLD NEWS
  { name: 'Al Jazeera',      category: 'World News', type: 'rss', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { name: 'Guardian World',  category: 'World News', type: 'rss', url: 'https://www.theguardian.com/world/rss' },
  { name: 'NPR World',       category: 'World News', type: 'rss', url: 'https://feeds.npr.org/1004/rss.xml' },
  { name: 'DW World',        category: 'World News', type: 'rss', url: 'https://rss.dw.com/rdf/rss-en-world' },

  // 📈 NOTABLE TRENDS
  { name: 'Platformer',      category: 'Notable Trends', type: 'rss', url: 'https://www.platformer.news/rss/' },

  // 🔭 SCIENCE & SPACE
  { name: 'Spaceflight Now',  category: 'Science & Space', type: 'rss', url: 'https://spaceflightnow.com/feed/' },
  { name: 'NASASpaceflight',  category: 'Science & Space', type: 'rss', url: 'https://www.nasaspaceflight.com/feed/' },
  { name: 'Universe Today',   category: 'Science & Space', type: 'rss', url: 'https://www.universetoday.com/feed/' },
  { name: 'Quanta Magazine',  category: 'Science & Space', type: 'rss', url: 'https://api.quantamagazine.org/feed/' },
  { name: 'ScienceDaily',     category: 'Science & Space', type: 'rss', url: 'https://www.sciencedaily.com/rss/top/science.xml' },
  { name: 'Ars Technica Science', category: 'Science & Space', type: 'rss', url: 'https://feeds.arstechnica.com/arstechnica/science' },

  // 🤖 AI & LLMs — incl. local AI releases
  { name: 'The Decoder',            category: 'AI & LLMs', type: 'rss', url: 'https://the-decoder.com/feed/' },
  { name: 'MIT Technology Review AI', category: 'AI & LLMs', type: 'rss', url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed' },
  { name: 'Simon Willison',         category: 'AI & LLMs', type: 'rss', url: 'https://simonwillison.net/atom/everything/' },
  { name: 'Hugging Face Blog',      category: 'AI & LLMs', type: 'rss', url: 'https://huggingface.co/blog/feed.xml' },
  { name: 'Ollama Releases',        category: 'AI & LLMs', type: 'rss', url: gh('ollama/ollama') },
  { name: 'LocalAI Releases',       category: 'AI & LLMs', type: 'rss', url: gh('mudler/LocalAI') },

  // 🔒 SECURITY — advisories, surveillance and digital rights
  { name: 'CISA Advisories',   category: 'Security', type: 'rss', url: 'https://www.cisa.gov/cybersecurity-advisories/all.xml' },
  { name: 'Cisco Security Advisories', category: 'Security', type: 'rss', url: 'https://sec.cloudapps.cisco.com/security/center/psirtrss20/CiscoSecurityAdvisory.xml' },
  { name: 'The Hacker News',   category: 'Security', type: 'rss', url: 'https://feeds.feedburner.com/TheHackersNews' },
  { name: 'BleepingComputer',  category: 'Security', type: 'rss', url: 'https://www.bleepingcomputer.com/feed/' },
  { name: 'SANS ISC',          category: 'Security', type: 'rss', url: 'https://isc.sans.edu/rssfeed_full.xml' },
  { name: 'The Record',        category: 'Security', type: 'rss', url: 'https://therecord.media/feed' },
  { name: 'EFF',               category: 'Security', type: 'rss', url: 'https://www.eff.org/rss/updates.xml' },
  { name: '404 Media',         category: 'Security', type: 'rss', url: 'https://www.404media.co/rss/' },

  // 💥 COMICS — beyond the Big Two
  { name: 'Bleeding Cool Comics', category: 'Comics', type: 'rss', url: 'https://bleedingcool.com/comics/feed/' },
  { name: 'The Beat',             category: 'Comics', type: 'rss', url: 'https://www.comicsbeat.com/feed/' },
  { name: 'The Comics Journal',   category: 'Comics', type: 'rss', url: 'https://www.tcj.com/feed/' },

  // 🎮 GAMING — emulation, decomps / native ports, modding, retro
  { name: 'Dolphin Emulator',  category: 'Gaming', type: 'rss', url: 'https://dolphin-emu.org/blog/feeds/' },
  { name: 'PCSX2',             category: 'Gaming', type: 'rss', url: 'https://pcsx2.net/blog/rss.xml' },
  { name: 'RPCS3',             category: 'Gaming', type: 'rss', url: 'https://blog.rpcs3.net/feed/' },
  { name: 'xemu Releases',     category: 'Gaming', type: 'rss', url: gh('xemu-project/xemu') },
  { name: 'Ship of Harkinian Releases', category: 'Gaming', type: 'rss', url: gh('HarbourMasters/Shipwright') },
  { name: 'OpenGOAL Releases', category: 'Gaming', type: 'rss', url: gh('open-goal/jak-project') },
  { name: 'ModDB',             category: 'Gaming', type: 'rss', url: 'https://rss.moddb.com/news/feed/rss.xml' },
  { name: 'GBAtemp',           category: 'Gaming', type: 'rss', url: 'https://gbatemp.net/forums/-/index.rss' },
  { name: 'Time Extension',    category: 'Gaming', type: 'rss', url: 'https://www.timeextension.com/feeds/latest' },

  // 💻 TECH — self-hosting, Android root & modding
  { name: 'selfh.st',          category: 'Tech & Hardware', type: 'rss', url: 'https://selfh.st/rss/' },
  { name: 'Tailscale Blog',    category: 'Tech & Hardware', type: 'rss', url: 'https://tailscale.com/blog/index.xml' },
  { name: 'Jellyfin Releases', category: 'Tech & Hardware', type: 'rss', url: gh('jellyfin/jellyfin') },
  { name: 'XDA Developers',    category: 'Tech & Hardware', type: 'rss', url: 'https://www.xda-developers.com/feed/' },
  { name: 'Android Police',    category: 'Tech & Hardware', type: 'rss', url: 'https://www.androidpolice.com/feed/' },
  { name: 'Magisk Releases',   category: 'Tech & Hardware', type: 'rss', url: gh('topjohnwu/Magisk') },
  { name: 'KernelSU Releases', category: 'Tech & Hardware', type: 'rss', url: gh('tiann/KernelSU') },
];
