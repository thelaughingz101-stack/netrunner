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
  // Plain http: anyone on the network path could alter what reaches the AI Writer. All serve https.
  'PlayStation Blog':  { url: 'https://feeds.feedburner.com/psblog' },
  'IGN':               { url: 'https://feeds.ign.com/ign/all' },
  'Ars Technica':      { url: 'https://feeds.arstechnica.com/arstechnica/index' },
  'BBC World News':    { url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  'Politico Congress': { url: 'https://rss.politico.com/congress.xml' },
};

/**
 * Full names shown on the Sources tab, keyed by toggle key (sourceKey || name), for sources known by an
 * abbreviation. Digests keep the short name. Brands known by their letters (IGN, BBC, NPR, CNBC…) have none.
 */
export const SOURCE_LABELS: Record<string, string> = {
  // Health
  'WHO':         'World Health Organization (WHO)',
  'PAHO':        'Pan American Health Organization (PAHO)',
  'CDC':         'Centers for Disease Control and Prevention (CDC)',
  'CDC MMWR':    'CDC Morbidity and Mortality Weekly Report (MMWR)',
  'FDA':         'Food and Drug Administration (FDA)',
  'FDA Recalls': 'FDA Recalls & Safety Alerts',
  'NIH':         'National Institutes of Health (NIH)',
  'HHS':         'U.S. Department of Health and Human Services (HHS)',
  'ECDC':        'European Centre for Disease Prevention and Control (ECDC)',
  // Elsewhere
  'AWN':             'Animation World Network (AWN)',
  'EFF':             'Electronic Frontier Foundation (EFF)',
  'CISA Advisories': 'Cybersecurity and Infrastructure Security Agency (CISA) Advisories',
  'SANS ISC':        'SANS Internet Storm Center (ISC)',
  'VGC':             'Video Games Chronicle (VGC)',
  'AP News':         'Associated Press (AP)',
  'DW World':        'Deutsche Welle (DW) World',
  'NYT Homepage':    'The New York Times (NYT)',
  'NY Post':         'New York Post',
  'WB Games':        'Warner Bros. Games',
  'CNETTV':          'CNET',
  'Wan Show (LTT)':  'WAN Show (Linus Tech Tips)',
};

const yt = (id: string) => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
const gh = (repo: string) => `https://github.com/${repo}/releases.atom`;
/** Google News search for one site's last day, for sites whose own feed is dead or blocked. */
const gn = (site: string) => `https://news.google.com/rss/search?q=site:${site}+when:1d&hl=en-US&gl=US&ceid=US:en`;

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

  // 🎬 TV & MOVIES — every major studio, not mostly Disney (Media Announcements was folded in here).
  // Fetched and checked on 2026-10-15. CinemaCon has no feed and its magazine, Boxoffice Pro, answers 403.
  { name: 'The Hollywood Reporter',     sourceKey: 'Hollywood Reporter', category: 'TV & Movies', type: 'rss', url: 'https://www.hollywoodreporter.com/feed/' },
  { name: 'Universal Pictures YouTube', sourceKey: 'Universal Pictures', category: 'TV & Movies', type: 'rss', url: yt('UCq0OueAsdxH6b8nyAspwViw') },
  { name: 'Sony Pictures YouTube',      sourceKey: 'Sony Pictures',      category: 'TV & Movies', type: 'rss', url: yt('UCz97F7dMxBNOfGYu3rx8aCw') },
  { name: 'Paramount Pictures YouTube', sourceKey: 'Paramount Pictures', category: 'TV & Movies', type: 'rss', url: yt('UCF9imwPMSGz4Vq1NiTWCC7g') },
  { name: 'Lionsgate YouTube',          sourceKey: 'Lionsgate',          category: 'TV & Movies', type: 'rss', url: yt('UCJ6nMHaJPZvsJ-HmUmj1SeA') },

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

  // 🩺 HEALTH — official public-health bodies only (fetched and checked on 2026-10-15)
  // WHO's own RSS stopped updating in Feb 2026 and NIH's answers 403, so both come through Google News.
  // WHO: /news/item only. All of /news also returned its "News releases" index page (re-listed whenever it
  // changes; five copies merged into one empty bullet on 2026-10-15) plus meeting and webinar pages.
  { name: 'WHO',          category: 'Health', type: 'rss', url: gn('www.who.int/news/item') },
  { name: 'WHO YouTube',  sourceKey: 'WHO', category: 'Health', type: 'rss', url: yt('UC07-dOwgza1IguKA86jqxNA') },
  { name: 'PAHO',         category: 'Health', type: 'rss', url: 'https://www.paho.org/en/rss.xml' },
  // max=20: without it CDC sends its whole archive (1.4–2 MB, back to 2015).
  { name: 'CDC',          category: 'Health', type: 'rss', url: 'https://tools.cdc.gov/api/v2/resources/media/132608.rss?max=20' },
  { name: 'CDC MMWR',     category: 'Health', type: 'rss', url: 'https://tools.cdc.gov/api/v2/resources/media/342778.rss?max=20' },
  { name: 'FDA',          category: 'Health', type: 'rss', url: 'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/press-releases/rss.xml' },
  { name: 'FDA Recalls',  category: 'Health', type: 'rss', url: 'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/recalls/rss.xml' },
  { name: 'NIH',          category: 'Health', type: 'rss', url: gn('www.nih.gov/news-events') },
  { name: 'HHS',          category: 'Health', type: 'rss', url: 'https://www.hhs.gov/rss/news.xml' },
  { name: 'ECDC',         category: 'Health', type: 'rss', url: 'https://www.ecdc.europa.eu/en/taxonomy/term/1307/feed' },

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
