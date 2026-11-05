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
  // Moved feed (404). Music news, so its own Music topic (it sat in Business & Finance in n8n).
  'Billboard':     { url: 'https://www.billboard.com/feed/', category: 'Music' },
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
  // Feed review, 2026-11-05 (the last 8 runs): dead, broken, or mostly thrown out by the AI.
  'Hacker News':  { url: 'https://hnrss.org/frontpage' },              // news.ycombinator.com answered 419 in 5 of 6 runs
  'NY Post':      { url: 'https://nypost.com/politics/feed/' },        // the main feed is mostly sports and celebrity (11 of 27 thrown out)
  'CBR Comics':   { url: 'https://www.cbr.com/feed/category/comics/' }, // the main feed is film listicles (18 of 24 thrown out)
  'Wikipedia Current Events (history)': null,                        // page-edit history, nothing since 2024
  'Wikipedia Current Events (Google proxy)': null,                   // category and history pages: 16 of 16 thrown out
  'Giant Freakin Robot': null,                                       // film listicles, never a leak or rumor: 15 of 15 thrown out
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
  'NASA':            'National Aeronautics and Space Administration (NASA)',
  'BBC World News':  'British Broadcasting Corporation (BBC) World News',
  'NPR World':       'National Public Radio (NPR) World',
  'C-SPAN':          'Cable-Satellite Public Affairs Network (C-SPAN)',
  'MIT Technology Review AI': 'Massachusetts Institute of Technology (MIT) Technology Review AI',
  // Official bodies and nonprofits (added 2026-10-22)
  'NSA':             'National Security Agency (NSA) Cybersecurity',
  'FBI IC3':         'Federal Bureau of Investigation (FBI) Internet Crime Complaint Center (IC3)',
  'NIST CSRC':       'National Institute of Standards and Technology (NIST) Computer Security Resource Center (CSRC)',
  'CERT/CC':         'CERT Coordination Center (CERT/CC), Carnegie Mellon University',
  'UK NCSC':         'UK National Cyber Security Centre (NCSC)',
  'Canadian Centre for Cyber Security': 'Canadian Centre for Cyber Security (CCCS)',
  'ACSC':            'Australian Cyber Security Centre (ACSC)',
  'ENISA':           'European Union Agency for Cybersecurity (ENISA)',
  'FTC Consumer Alerts': 'Federal Trade Commission (FTC) Consumer Alerts',
  'EMA':             'European Medicines Agency (EMA)',
  'UKHSA':           'UK Health Security Agency (UKHSA)',
  'USDA FSIS':       'U.S. Department of Agriculture (USDA) Food Safety and Inspection Service (FSIS) Recalls',
  'CPSC':            'U.S. Consumer Product Safety Commission (CPSC) Recalls',
  'CMS':             'Centers for Medicare & Medicaid Services (CMS)',
  'SAMHSA':          'Substance Abuse and Mental Health Services Administration (SAMHSA)',
  'KFF Health News': 'KFF Health News (Kaiser Family Foundation)',
  'ESA':             'European Space Agency (ESA)',
  'NOAA':            'National Oceanic and Atmospheric Administration (NOAA)',
  'NSF':             'U.S. National Science Foundation (NSF)',
  'NASA JPL':        'NASA Jet Propulsion Laboratory (JPL)',
  'NIST':            'National Institute of Standards and Technology (NIST)',
  'Science (AAAS)':  'Science, from the American Association for the Advancement of Science (AAAS)',
  'National Academies': 'National Academies of Sciences, Engineering, and Medicine',
  'NWS':             'National Weather Service (NWS) Extreme Alerts',
  'NHC':             'National Hurricane Center (NHC)',
  'USGS Earthquakes': 'U.S. Geological Survey (USGS) Significant Earthquakes',
  'GAO':             'U.S. Government Accountability Office (GAO)',
  'CBO':             'Congressional Budget Office (CBO)',
  'Supreme Court':   'Supreme Court of the United States (SCOTUS)',
  'UN News':         'United Nations (UN) News',
  'ReliefWeb':       'ReliefWeb (UN Office for the Coordination of Humanitarian Affairs, OCHA)',
  'NATO':            'North Atlantic Treaty Organization (NATO)',
  'ICRC':            'International Committee of the Red Cross (ICRC)',
  'CFR':             'Council on Foreign Relations (CFR)',
  'SEC':             'U.S. Securities and Exchange Commission (SEC)',
  'BLS':             'U.S. Bureau of Labor Statistics (BLS)',
  'BEA':             'U.S. Bureau of Economic Analysis (BEA)',
  'FTC':             'Federal Trade Commission (FTC)',
  'CFPB':            'Consumer Financial Protection Bureau (CFPB)',
  'FDIC':            'Federal Deposit Insurance Corporation (FDIC)',
  'IMF':             'International Monetary Fund (IMF)',
  'OECD':            'Organisation for Economic Co-operation and Development (OECD)',
  'ECB':             'European Central Bank (ECB)',
  'NBER':            'National Bureau of Economic Research (NBER)',
  'FCC':             'Federal Communications Commission (FCC)',
  'W3C':             'World Wide Web Consortium (W3C)',
  'IETF':            'Internet Engineering Task Force (IETF)',
  'ICANN':           'Internet Corporation for Assigned Names and Numbers (ICANN)',
  'UK AISI':         'UK AI Security Institute (AISI)',
  'Stanford HAI':    'Stanford Institute for Human-Centered Artificial Intelligence (HAI)',
  'METR':            'Model Evaluation & Threat Research (METR)',
  'Ai2':             'Allen Institute for Artificial Intelligence (Ai2)',
  'arXiv':           'arXiv (artificial intelligence and language research papers)',
  'MPA':             'Motion Picture Association (MPA)',
  'CBLDF':           'Comic Book Legal Defense Fund (CBLDF)',
  'Rowan Cheung':    'Rowan Cheung (The Rundown AI)',
  'DC Universe':     'DC',
  'UK Prime Minister': "UK Prime Minister's Office (10 Downing Street)",
  'UK Parliament':   'UK Parliament (House of Commons, House of Lords)',
};

const yt = (id: string) => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
const gh = (repo: string) => `https://github.com/${repo}/releases.atom`;
/** Google News search for one site's last day, for sites whose own feed is dead or blocked. */
// A week, not a day: these bodies post a few times a week, so a day often came back empty (NIST, ENISA, JPL,
// Rockstar every run, 2026-10). The run's own time window still keeps only what's inside the catch-up range.
const gn = (site: string) => `https://news.google.com/rss/search?q=site:${site}+when:7d&hl=en-US&gl=US&ceid=US:en`;
/** A Bluesky account's posts (Bluesky serves RSS for every profile). */
const bsky = (handle: string) => `https://bsky.app/profile/${handle}/rss`;

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
  { name: 'Time Extension',    category: 'Gaming', type: 'rss', url: 'https://www.timeextension.com/feeds/latest' },

  // 💻 TECH — self-hosting, Android root & modding
  { name: 'selfh.st',          category: 'Tech & Hardware', type: 'rss', url: 'https://selfh.st/rss/' },
  { name: 'Tailscale Blog',    category: 'Tech & Hardware', type: 'rss', url: 'https://tailscale.com/blog/index.xml' },
  { name: 'Jellyfin Releases', category: 'Tech & Hardware', type: 'rss', url: gh('jellyfin/jellyfin') },
  { name: 'XDA Developers',    category: 'Tech & Hardware', type: 'rss', url: 'https://www.xda-developers.com/feed/' },
  { name: 'Android Police',    category: 'Tech & Hardware', type: 'rss', url: 'https://www.androidpolice.com/feed/' },
  { name: 'Magisk Releases',   category: 'Tech & Hardware', type: 'rss', url: gh('topjohnwu/Magisk') },
  { name: 'KernelSU Releases', category: 'Tech & Hardware', type: 'rss', url: gh('tiann/KernelSU') },

  // ── Official bodies and nonprofits (Zion, 2026-10-22). Each fetched and checked that day. Google News
  // stands in where the agency has no working feed (NSA, CMS, Treasury, IMF…). Not added, for lack of any
  // usable feed: the game ratings boards (ESRB's feed is its privacy blog), GDC, the Academy, WGA, DGA,
  // SAG-AFTRA (Google News only finds member pages), BFI, ASIFA-Hollywood, Annecy, AJA, AnimeJapan, CERN,
  // JAXA, NOAA SWPC, FEC, Shadowserver, OWASP, Epoch AI, OECD.AI, the EU AI Office and NIST's CAISI.

  // 🔒 SECURITY
  { name: 'NSA',             category: 'Security', type: 'rss', url: gn('nsa.gov') },
  { name: 'FBI IC3',         category: 'Security', type: 'rss', url: 'https://www.ic3.gov/PSA/RSS' },
  { name: 'NIST CSRC',       category: 'Security', type: 'rss', url: gn('csrc.nist.gov') },
  { name: 'CERT/CC',         category: 'Security', type: 'rss', url: 'https://www.kb.cert.org/vuls/atomfeed/' },
  { name: 'UK NCSC',         category: 'Security', type: 'rss', url: 'https://www.ncsc.gov.uk/api/1/services/v1/news-rss-feed.xml' },
  { name: 'Canadian Centre for Cyber Security', category: 'Security', type: 'rss', url: 'https://www.cyber.gc.ca/api/cccs/rss/v1/get?feed=alerts_advisories&lang=en' },
  { name: 'ACSC',            category: 'Security', type: 'rss', url: 'https://www.cyber.gov.au/rss/alerts' },
  // /news only: the whole site also brings in its vulnerability database's entries (euvd.enisa.europa.eu).
  { name: 'ENISA',           category: 'Security', type: 'rss', url: gn('enisa.europa.eu/news') },
  { name: 'FTC Consumer Alerts', category: 'Security', type: 'rss', url: gn('consumer.ftc.gov') },
  { name: 'Citizen Lab',     category: 'Security', type: 'rss', url: 'https://citizenlab.ca/feed/' },

  // 🩺 HEALTH
  { name: 'EMA',             category: 'Health', type: 'rss', url: 'https://www.ema.europa.eu/en/news.xml' },
  // Links are plain www.gov.uk pages, so these items take the feed's own tag (tagSource).
  { name: 'UKHSA',           category: 'Health', type: 'rss', url: 'https://www.gov.uk/government/organisations/uk-health-security-agency.atom' },
  { name: 'Health Canada',   category: 'Health', type: 'rss', url: 'https://api.io.canada.ca/io-server/gc/news/en/v2?dept=departmentofhealth&sort=publishedDate&orderBy=desc&pick=50&format=atom&atomtitle=Health%20Canada' },
  { name: 'USDA FSIS',       category: 'Health', type: 'rss', url: 'https://www.fsis.usda.gov/fsis-content/rss/recalls.xml' },
  { name: 'CPSC',            category: 'Health', type: 'rss', url: 'https://www.cpsc.gov/Newsroom/CPSC-RSS-Feed/Recalls-RSS' },
  { name: 'CMS',             category: 'Health', type: 'rss', url: gn('cms.gov/newsroom') },
  { name: 'SAMHSA',          category: 'Health', type: 'rss', url: gn('samhsa.gov') }, // own feed answers 403
  { name: 'Cochrane',        category: 'Health', type: 'rss', url: 'https://www.cochrane.org/news/rss.xml' },
  { name: 'KFF Health News', category: 'Health', type: 'rss', url: 'https://kffhealthnews.org/feed/' },

  // 🔭 SCIENCE & SPACE
  { name: 'ESA',             category: 'Science & Space', type: 'rss', url: 'https://www.esa.int/rssfeed/TopNews' },
  { name: 'NOAA',            category: 'Science & Space', type: 'rss', url: 'https://www.noaa.gov/rss.xml' },
  { name: 'NSF',             category: 'Science & Space', type: 'rss', url: 'https://www.nsf.gov/rss/rss_www_news.xml' },
  { name: 'NASA JPL',        category: 'Science & Space', type: 'rss', url: gn('jpl.nasa.gov/news') }, // own feed is malformed XML
  { name: 'NIST',            category: 'Science & Space', type: 'rss', url: 'https://www.nist.gov/news-events/news/rss.xml' },
  { name: 'Science (AAAS)',  category: 'Science & Space', type: 'rss', url: 'https://www.science.org/rss/news_current.xml' },
  { name: 'Smithsonian Magazine', category: 'Science & Space', type: 'rss', url: 'https://www.smithsonianmag.com/rss/latest_articles/' },
  { name: 'National Academies', category: 'Science & Space', type: 'rss', url: gn('nationalacademies.org') },

  // 🌪️ WEATHER & DISASTERS — official warnings only
  { name: 'NWS',             category: 'Weather & Disasters', type: 'rss', url: 'https://api.weather.gov/alerts/active.atom?severity=Extreme' },
  { name: 'NHC Atlantic',    sourceKey: 'NHC', category: 'Weather & Disasters', type: 'rss', url: 'https://www.nhc.noaa.gov/index-at.xml' },
  { name: 'NHC Eastern Pacific', sourceKey: 'NHC', category: 'Weather & Disasters', type: 'rss', url: 'https://www.nhc.noaa.gov/index-ep.xml' },
  { name: 'USGS Earthquakes', category: 'Weather & Disasters', type: 'rss', url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.atom' },

  // 🏛️ US POLITICS
  { name: 'Federal Register Presidential Documents', sourceKey: 'Federal Register', category: 'US Politics', type: 'rss', url: 'https://www.federalregister.gov/api/v1/documents.rss?conditions%5Btype%5D%5B%5D=PRESDOCU' },
  { name: 'Federal Register Significant Rules',      sourceKey: 'Federal Register', category: 'US Politics', type: 'rss', url: 'https://www.federalregister.gov/api/v1/documents.rss?conditions%5Bsignificant%5D=1' },
  { name: 'GAO',             category: 'US Politics', type: 'rss', url: 'https://www.gao.gov/rss/reports.xml' },
  { name: 'CBO',             category: 'US Politics', type: 'rss', url: 'https://www.cbo.gov/publications/all/rss.xml' },
  // Its own RSS has no dates; Google News lists new bill texts.
  { name: 'Congress.gov',    category: 'US Politics', type: 'rss', url: gn('congress.gov/bill') },
  { name: 'Supreme Court',   category: 'US Politics', type: 'rss', url: gn('supremecourt.gov') },
  { name: 'OpenSecrets',     category: 'US Politics', type: 'rss', url: gn('opensecrets.org') }, // own feed answers 403
  { name: 'FactCheck.org',   category: 'US Politics', type: 'rss', url: 'https://www.factcheck.org/feed/' },
  { name: 'Ballotpedia',     category: 'US Politics', type: 'rss', url: 'https://news.ballotpedia.org/feed/' },
  { name: 'ProPublica',      category: 'US Politics', type: 'rss', url: 'https://www.propublica.org/feeds/propublica/main' },

  // 🌍 WORLD NEWS
  { name: 'UN News',         category: 'World News', type: 'rss', url: 'https://news.un.org/feed/subscribe/en/news/all/rss.xml' },
  // ReliefWeb answers 406 to feed readers; /report keeps out its job ads.
  { name: 'ReliefWeb',       category: 'World News', type: 'rss', url: gn('reliefweb.int/report') },
  { name: 'State Department', category: 'World News', type: 'rss', url: 'https://www.state.gov/rss-feed/press-releases/feed/' },
  { name: 'European Commission', category: 'World News', type: 'rss', url: gn('ec.europa.eu/commission/presscorner') },
  { name: 'NATO',            category: 'World News', type: 'rss', url: gn('nato.int') },
  { name: 'ICRC',            category: 'World News', type: 'rss', url: 'https://www.icrc.org/en/rss/news' },
  { name: 'Human Rights Watch', category: 'World News', type: 'rss', url: 'https://www.hrw.org/rss/news' },
  { name: 'Amnesty International', category: 'World News', type: 'rss', url: 'https://www.amnesty.org/en/feed/' },
  { name: 'CFR',             category: 'World News', type: 'rss', url: gn('cfr.org') },

  // 💼 BUSINESS & FINANCE
  { name: 'Federal Reserve', category: 'Business & Finance', type: 'rss', url: 'https://www.federalreserve.gov/feeds/press_all.xml' },
  { name: 'SEC',             category: 'Business & Finance', type: 'rss', url: 'https://www.sec.gov/news/pressreleases.rss' },
  // BLS's "latest" feed is one fixed item; each release has its own feed.
  { name: 'BLS Jobs Report', sourceKey: 'BLS', category: 'Business & Finance', type: 'rss', url: 'https://www.bls.gov/feed/empsit.rss' },
  { name: 'BLS Consumer Price Index', sourceKey: 'BLS', category: 'Business & Finance', type: 'rss', url: 'https://www.bls.gov/feed/cpi.rss' },
  { name: 'BEA',             category: 'Business & Finance', type: 'rss', url: 'https://apps.bea.gov/rss/rss.xml' },
  { name: 'Treasury',        category: 'Business & Finance', type: 'rss', url: gn('home.treasury.gov') },
  { name: 'FTC',             category: 'Business & Finance', type: 'rss', url: 'https://www.ftc.gov/feeds/press-release.xml' },
  { name: 'CFPB',            category: 'Business & Finance', type: 'rss', url: 'https://www.consumerfinance.gov/about-us/newsroom/feed/' },
  { name: 'FDIC',            category: 'Business & Finance', type: 'rss', url: gn('fdic.gov') },
  { name: 'IMF',             category: 'Business & Finance', type: 'rss', url: gn('imf.org') },
  { name: 'World Bank',      category: 'Business & Finance', type: 'rss', url: gn('worldbank.org') },
  { name: 'OECD',            category: 'Business & Finance', type: 'rss', url: gn('oecd.org') },
  { name: 'ECB',             category: 'Business & Finance', type: 'rss', url: 'https://www.ecb.europa.eu/rss/press.html' },
  { name: 'Bank of England', category: 'Business & Finance', type: 'rss', url: 'https://www.bankofengland.co.uk/rss/news' },
  { name: 'Brookings',       category: 'Business & Finance', type: 'rss', url: gn('brookings.edu') }, // own feed is malformed XML
  { name: 'NBER',            category: 'Business & Finance', type: 'rss', url: gn('nber.org') }, // own feed has no dates

  // 💻 TECH & HARDWARE
  { name: 'FCC',             category: 'Tech & Hardware', type: 'rss', url: gn('fcc.gov/document') }, // own feed is malformed XML
  { name: 'Linux Foundation', category: 'Tech & Hardware', type: 'rss', url: 'https://www.linuxfoundation.org/blog/rss.xml' },
  { name: 'Mozilla',         category: 'Tech & Hardware', type: 'rss', url: 'https://blog.mozilla.org/en/feed/' },
  { name: 'W3C',             category: 'Tech & Hardware', type: 'rss', url: 'https://www.w3.org/news/feed/' },
  { name: 'IETF',            category: 'Tech & Hardware', type: 'rss', url: 'https://www.ietf.org/blog/feed/' },
  { name: 'ICANN',           category: 'Tech & Hardware', type: 'rss', url: gn('icann.org') },
  { name: 'Internet Society', category: 'Tech & Hardware', type: 'rss', url: 'https://www.internetsociety.org/feed/' },

  // 🤖 AI & LLMs
  { name: 'UK AISI',         category: 'AI & LLMs', type: 'rss', url: 'https://www.gov.uk/government/organisations/ai-security-institute.atom' },
  { name: 'Stanford HAI',    category: 'AI & LLMs', type: 'rss', url: gn('hai.stanford.edu') }, // own feed is malformed XML
  { name: 'METR',            category: 'AI & LLMs', type: 'rss', url: 'https://metr.org/feed.xml' },
  { name: 'Ai2',             category: 'AI & LLMs', type: 'rss', url: 'https://allenai.org/rss.xml' },
  { name: 'Partnership on AI', category: 'AI & LLMs', type: 'rss', url: 'https://partnershiponai.org/feed/' },
  { name: 'AI Now Institute', category: 'AI & LLMs', type: 'rss', url: 'https://ainowinstitute.org/feed' },
  // Hundreds of papers a day; the per-source cap keeps the newest.
  { name: 'arXiv cs.AI',     sourceKey: 'arXiv', category: 'AI & LLMs', type: 'rss', url: 'https://rss.arxiv.org/rss/cs.AI' },
  { name: 'arXiv cs.CL',     sourceKey: 'arXiv', category: 'AI & LLMs', type: 'rss', url: 'https://rss.arxiv.org/rss/cs.CL' },

  // 🎮 GAMING
  { name: 'Entertainment Software Association', category: 'Gaming', type: 'rss', url: 'https://www.theesa.com/news/feed/' },
  { name: 'Video Game History Foundation', category: 'Gaming', type: 'rss', url: 'https://gamehistory.org/feed/' },

  // 🎬 TV & MOVIES
  { name: 'Television Academy', category: 'TV & Movies', type: 'rss', url: gn('televisionacademy.com') },
  { name: 'MPA',             category: 'TV & Movies', type: 'rss', url: 'https://www.motionpictures.org/feed/' },
  { name: 'Sundance Institute', category: 'TV & Movies', type: 'rss', url: 'https://www.sundance.org/feed/' },

  // 🎨 ANIMATION
  { name: 'The Animation Guild', category: 'Animation', type: 'rss', url: 'https://animationguild.org/feed/' },

  // 📚 COMICS
  { name: 'CBLDF',           category: 'Comics', type: 'rss', url: 'https://cbldf.org/feed/' },
  { name: 'Comic-Con International', category: 'Comics', type: 'rss', url: 'https://www.comic-con.org/toucan/feed/' },
  { name: 'Library of Congress Headlines & Heroes', category: 'Comics', type: 'rss', url: 'https://blogs.loc.gov/headlinesandheroes/feed/' },

  // 🔮 NOTABLE TRENDS
  { name: 'Pew Research Center', category: 'Notable Trends', type: 'rss', url: 'https://www.pewresearch.org/feed/' },
  { name: 'Gallup',          category: 'Notable Trends', type: 'rss', url: gn('news.gallup.com') },

  // 🎵 MUSIC (Zion, 2026-10-22): Billboard plus these, fetched and checked that day.
  { name: 'Rolling Stone Music', category: 'Music', type: 'rss', url: 'https://www.rollingstone.com/music/feed/' },
  { name: 'Pitchfork',           category: 'Music', type: 'rss', url: 'https://pitchfork.com/feed/feed-news/rss' },
  { name: 'Stereogum',           category: 'Music', type: 'rss', url: 'https://www.stereogum.com/feed/' },
  { name: 'Consequence',         category: 'Music', type: 'rss', url: 'https://consequence.net/feed/' },
  { name: 'NME',                 category: 'Music', type: 'rss', url: 'https://www.nme.com/news/music/feed' },

  // 🦋 BLUESKY — the X accounts (never fetched: xCancel only returned placeholders) that also post on Bluesky,
  // checked 2026-10-22: verified or on their own domain, and posting in the last two months. Each shares its
  // brand's Sources toggle. Not added: accounts whose site is already a feed here (The Verge, The Hollywood
  // Reporter, AIPT, The Beat), ones quiet for months (Xbox, Netflix, Microsoft, Tom Henderson, Philip DeFranco,
  // Pubity, ComicBook.com) or with no posts (Rockstar, Bandai Namco, Anthropic, Rowan Cheung), and ones with no
  // account of their own we could confirm (HBO, Warner Bros, Adult Swim, Disney, DC, Marvel, Toei, OpenAI…).
  { name: 'Wario64 Bluesky',        sourceKey: 'Wario64',        category: 'Gaming', type: 'rss', url: bsky('wario64.bsky.social') },
  { name: 'Shinobi602 Bluesky',     sourceKey: 'Shinobi602',     category: 'Gaming', type: 'rss', url: bsky('shinobi602.bsky.social') },
  { name: 'PlayStation Bluesky',    sourceKey: 'PlayStation',    category: 'Gaming', type: 'rss', url: bsky('playstation.com') },
  { name: 'Steam Bluesky',          sourceKey: 'Steam',          category: 'Gaming', type: 'rss', url: bsky('steampowered.com') },
  { name: 'Konami Bluesky',         sourceKey: 'Konami',         category: 'Gaming', type: 'rss', url: bsky('konamina.bsky.social') },
  { name: 'Ubisoft Bluesky',        sourceKey: 'Ubisoft',        category: 'Gaming', type: 'rss', url: bsky('ubisoft.com') },
  { name: 'Bethesda Bluesky',       sourceKey: 'Bethesda',       category: 'Gaming', type: 'rss', url: bsky('bethesda.net') },
  { name: 'CD Projekt Red Bluesky', sourceKey: 'CD Projekt Red', category: 'Gaming', type: 'rss', url: bsky('cdprojektred.com') },
  { name: 'Valve Bluesky',          sourceKey: 'Valve',          category: 'Gaming', type: 'rss', url: bsky('valvesoftware.com') },
  { name: 'DiscussingFilm Bluesky', sourceKey: 'DiscussingFilm', category: 'TV & Movies', type: 'rss', url: bsky('discussingfilm.net') },
  { name: 'Culture Crave Bluesky',  sourceKey: 'Culture Crave',  category: 'TV & Movies', type: 'rss', url: bsky('culturecrave.co') },
  { name: 'Catsuka Bluesky',        sourceKey: 'Catsuka',        category: 'Animation', type: 'rss', url: bsky('catsuka.bsky.social') },
  // Second pass (Zion, 2026-10-22: "translate the X sources to Bluesky, and go on from there"). Every X account
  // was searched on Bluesky again; where none posts, its own site, newsroom or YouTube channel stands in, under
  // the same Sources toggle. Covered already by the same brand's feeds: Bandai Namco, WB Games, Warner Bros,
  // Adult Swim, Toei, Netflix, Apple, Nvidia, Google, OpenAI, ChatGPT (OpenAI), Anthropic, The Verge, The
  // Hollywood Reporter, AIPT, The Beat, HBO Max (the Max channel), Tom Henderson (Insider Gaming). Nothing to
  // be found: BenjiSales, Bindu Reddy, The Snitch, ToonHive, Cartoon Base. Unofficial X-mirror bots on Bluesky
  // (rockstargames.xmirror.bot…) aren't used.
  { name: 'DC Bluesky',             sourceKey: 'DC Universe',    category: 'TV & Movies', type: 'rss', url: bsky('dc.com') },
  { name: 'Xbox Game Pass Bluesky', sourceKey: 'Xbox',           category: 'Gaming', type: 'rss', url: bsky('gamepass.xbox.com') },
  { name: 'Official Microsoft Blog', sourceKey: 'Microsoft',     category: 'Tech & Hardware', type: 'rss', url: 'https://blogs.microsoft.com/feed/' },
  { name: 'Sony YouTube',           sourceKey: 'Sony',           category: 'Tech & Hardware', type: 'rss', url: yt('UCVjS9AuBloqJJjhsy3vIfug') },
  { name: 'HBO YouTube',            sourceKey: 'HBO',            category: 'TV & Movies', type: 'rss', url: yt('UCVTQuK2CaWaTgSsoNkn5AiQ') },
  { name: 'Disney YouTube',         sourceKey: 'Disney',         category: 'TV & Movies', type: 'rss', url: yt('UC_5niPa-d35gg88HaS7RrIw') },
  { name: 'Walt Disney Company News', sourceKey: 'Disney',       category: 'TV & Movies', type: 'rss', url: 'https://thewaltdisneycompany.com/feed/' },
  { name: 'Marvel.com',             category: 'Comics', type: 'rss', url: gn('marvel.com/articles') }, // no feed of its own
  { name: 'Rockstar Newswire',      sourceKey: 'Rockstar Games', category: 'Gaming', type: 'rss', url: gn('rockstargames.com/newswire') }, // no feed of its own
  { name: 'The Rundown AI',         sourceKey: 'Rowan Cheung',   category: 'AI & LLMs', type: 'rss', url: 'https://www.therundown.ai/feed' },
  // Its comics section only: the whole site's feed is mostly games, film and TV, which would all land in Comics.
  { name: 'ComicBook.com Comics',   sourceKey: 'ComicBook.com',  category: 'Comics', type: 'rss', url: 'https://comicbook.com/category/comics/feed/' },

  // 📚 COMICS PUBLISHERS (Zion, 2026-10-22): the publishers the Comics rules list, from their own feeds, or
  // their official Bluesky accounts where the site has none. Checked that day. Not added: Image Comics (no
  // feed; its Bluesky has been quiet since August), Oni Press and Titan (nothing working).
  { name: 'DC.com',                 category: 'Comics', type: 'rss', url: gn('dc.com/blog') }, // no feed of its own
  { name: 'Dark Horse Comics',      category: 'Comics', type: 'rss', url: 'https://www.darkhorse.com/Blog/rss' },
  { name: 'Archie Comics',          category: 'Comics', type: 'rss', url: 'https://archiecomics.com/feed/' },
  { name: 'BOOM! Studios Bluesky',  sourceKey: 'BOOM! Studios',    category: 'Comics', type: 'rss', url: bsky('boom-studios.com') },
  { name: 'Dynamite Bluesky',       sourceKey: 'Dynamite',         category: 'Comics', type: 'rss', url: bsky('dynamitecomicshq.bsky.social') },
  { name: 'IDW Publishing Bluesky', sourceKey: 'IDW Publishing',   category: 'Comics', type: 'rss', url: bsky('idwpublishing.com') },
  { name: 'Fantagraphics Bluesky',  sourceKey: 'Fantagraphics',    category: 'Comics', type: 'rss', url: bsky('fantagraphics.bsky.social') },
  { name: 'Mad Cave Studios Bluesky', sourceKey: 'Mad Cave Studios', category: 'Comics', type: 'rss', url: bsky('madcavestudios.com') },
  { name: 'Skybound Bluesky',       sourceKey: 'Skybound',         category: 'Comics', type: 'rss', url: bsky('skybound.bsky.social') },

  // 🏛️ GOVERNMENTS' OWN WORD (Zion, 2026-10-22): the White House newsroom (statements, briefings, fact sheets,
  // presidential actions) beside its YouTube channel, and the UK's equivalents: Number 10 and Parliament.
  // Truth Social isn't used: it blocks feed readers, like X; its posts that matter are reported by the wires.
  { name: 'White House News',       sourceKey: 'White House',      category: 'US Politics', type: 'rss', url: 'https://www.whitehouse.gov/news/feed/' },
  // Links are plain www.gov.uk pages, so its items take the feed's own tag (tagSource).
  { name: 'UK Prime Minister',      category: 'World News', type: 'rss', url: 'https://www.gov.uk/government/organisations/prime-ministers-office-10-downing-street.atom' },
  // parliament.uk refuses feed readers (403); Parliament, the Commons and the Lords post on Bluesky.
  { name: 'UK Parliament Bluesky',  sourceKey: 'UK Parliament',    category: 'World News', type: 'rss', url: bsky('ukparliament.parliament.uk') },
  { name: 'House of Commons Bluesky', sourceKey: 'UK Parliament',  category: 'World News', type: 'rss', url: bsky('houseofcommons.parliament.uk') },
  { name: 'House of Lords Bluesky', sourceKey: 'UK Parliament',    category: 'World News', type: 'rss', url: bsky('houseoflords.parliament.uk') },
];

/**
 * Official bodies: government agencies, intergovernmental bodies and nonprofit institutions, by toggle key.
 * When one of them and the press cover the same story, the agency's item leads (clustering and the AI's rule),
 * and the Start tab's "Official only" starting point keeps just these.
 */
export const OFFICIAL_SOURCES = new Set<string>([
  // Already in the catalog
  'NASA', 'White House', 'C-SPAN', 'WHO', 'PAHO', 'CDC', 'CDC MMWR', 'FDA', 'FDA Recalls', 'NIH', 'HHS', 'ECDC',
  'CISA Advisories', 'EFF',
  // Added 2026-10-22
  'NSA', 'FBI IC3', 'NIST CSRC', 'CERT/CC', 'UK NCSC', 'Canadian Centre for Cyber Security', 'ACSC', 'ENISA',
  'FTC Consumer Alerts', 'Citizen Lab',
  'EMA', 'UKHSA', 'Health Canada', 'USDA FSIS', 'CPSC', 'CMS', 'SAMHSA', 'Cochrane', 'KFF Health News',
  'ESA', 'NOAA', 'NSF', 'NASA JPL', 'NIST', 'Science (AAAS)', 'Smithsonian Magazine', 'National Academies',
  'NWS', 'NHC', 'USGS Earthquakes', 'FEMA', // FEMA: its feed 404s since 2026-10 and Google News has nothing; tagging only
  'Federal Register', 'GAO', 'CBO', 'Congress.gov', 'Supreme Court', 'OpenSecrets', 'FactCheck.org', 'Ballotpedia', 'ProPublica',
  'UN News', 'ReliefWeb', 'State Department', 'European Commission', 'NATO', 'ICRC', 'Human Rights Watch', 'Amnesty International', 'CFR',
  'Federal Reserve', 'SEC', 'BLS', 'BEA', 'Treasury', 'FTC', 'CFPB', 'FDIC', 'IMF', 'World Bank', 'OECD', 'ECB', 'Bank of England', 'Brookings', 'NBER',
  'FCC', 'Linux Foundation', 'Mozilla', 'W3C', 'IETF', 'ICANN', 'Internet Society',
  'UK AISI', 'Stanford HAI', 'METR', 'Ai2', 'Partnership on AI', 'AI Now Institute', 'arXiv',
  'Entertainment Software Association', 'Video Game History Foundation',
  'Television Academy', 'MPA', 'Sundance Institute', 'The Animation Guild',
  'CBLDF', 'Comic-Con International', 'Library of Congress Headlines & Heroes',
  'Pew Research Center', 'Gallup',
  'UK Prime Minister', 'UK Parliament',
]);
