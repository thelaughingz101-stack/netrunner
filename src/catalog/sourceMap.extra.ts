import type { SourceTag } from './types.js';

// Tagging rules for sources added in feeds.extra.ts. Merged over the generated maps.
// SOURCE_MAP keys are domains ("example.com") or domain+path ("reddit.com/r/foo"); the longest match
// wins, so a path key can split one domain across sections (Ars Technica Science vs Ars Technica).
const t = (name: string, category: string): SourceTag => ({ name, category });

export const EXTRA_SOURCE_MAP: Record<string, SourceTag> = {
  // n8n-era feeds that never had a tag: their items fell into Custom Feeds (wrong section, and
  // exempt from the per-source cap — ~70 items a run). Names match the feeds' Sources toggles.
  'nypost.com':      t('NY Post', 'US Politics'),
  'pagesix.com':     t('NY Post', 'US Politics'),
  'nytimes.com':     t('NYT Homepage', 'US Politics'),
  'vox.com':         t('Vox', 'US Politics'),
  'rollcall.com':    t('Roll Call', 'US Politics'),
  'wired.com':       t('Wired', 'Tech & Hardware'),
  'appleinsider.com': t('AppleInsider', 'Tech & Hardware'),
  'cnet.com':        t('CNET', 'Tech & Hardware'),

  // TV & Movies
  'hollywoodreporter.com': t('Hollywood Reporter', 'TV & Movies'),
  // Animation
  'cartoonbrew.com':                 t('Cartoon Brew', 'Animation'),
  'animationmagazine.net':           t('Animation Magazine', 'Animation'),
  'awn.com':                         t('AWN', 'Animation'),
  'skwigly.co.uk':                   t('Skwigly', 'Animation'),
  'animationscoop.com':              t('Animation Scoop', 'Animation'),
  'animationobsessive.substack.com': t('Animation Obsessive', 'Animation'),
  // Business & Finance
  'cnbc.com':        t('CNBC', 'Business & Finance'),
  'marketwatch.com': t('MarketWatch', 'Business & Finance'),
  'ft.com':          t('Financial Times', 'Business & Finance'),
  'fortune.com':     t('Fortune', 'Business & Finance'),
  // World News
  'aljazeera.com':   t('Al Jazeera', 'World News'),
  'theguardian.com': t('Guardian World', 'World News'),
  'npr.org':         t('NPR World', 'World News'),
  'dw.com':          t('DW World', 'World News'),
  // Notable Trends
  'platformer.news': t('Platformer', 'Notable Trends'),
  // Science & Space
  'spaceflightnow.com':      t('Spaceflight Now', 'Science & Space'),
  'nasaspaceflight.com':     t('NASASpaceflight', 'Science & Space'),
  'universetoday.com':       t('Universe Today', 'Science & Space'),
  'quantamagazine.org':      t('Quanta Magazine', 'Science & Space'),
  'sciencedaily.com':        t('ScienceDaily', 'Science & Space'),
  'arstechnica.com/science': t('Ars Technica Science', 'Science & Space'),
  'arstechnica.com/space':   t('Ars Technica Science', 'Science & Space'),
  // Health. CDC's feeds link through tools.cdc.gov's downloader; m= is the feed, so MMWR gets its own tag.
  'who.int':        t('WHO', 'Health'),
  'paho.org':       t('PAHO', 'Health'),
  'cdc.gov':        t('CDC', 'Health'),
  'tools.cdc.gov/api/embed/downloader/download.asp?m=342778': t('CDC MMWR', 'Health'),
  'fda.gov':        t('FDA', 'Health'),
  'fda.gov/safety/': t('FDA Recalls', 'Health'),
  'nih.gov':        t('NIH', 'Health'),
  'hhs.gov':        t('HHS', 'Health'),
  'ecdc.europa.eu': t('ECDC', 'Health'),
  // AI & LLMs
  'the-decoder.com':          t('The Decoder', 'AI & LLMs'),
  'technologyreview.com':     t('MIT Technology Review AI', 'AI & LLMs'),
  'simonwillison.net':        t('Simon Willison', 'AI & LLMs'),
  'huggingface.co/blog':      t('Hugging Face Blog', 'AI & LLMs'),
  'github.com/ollama/ollama': t('Ollama Releases', 'AI & LLMs'),
  'github.com/mudler/LocalAI': t('LocalAI Releases', 'AI & LLMs'),
  // Security
  'cisa.gov':             t('CISA Advisories', 'Security'),
  'cisco.com':            t('Cisco Security Advisories', 'Security'),
  'thehackernews.com':    t('The Hacker News', 'Security'),
  'bleepingcomputer.com': t('BleepingComputer', 'Security'),
  'isc.sans.edu':         t('SANS ISC', 'Security'),
  'therecord.media':      t('The Record', 'Security'),
  'eff.org':              t('EFF', 'Security'),
  '404media.co':          t('404 Media', 'Security'),
  // Comics
  'bleedingcool.com/comics': t('Bleeding Cool Comics', 'Comics'),
  'comicsbeat.com':          t('The Beat', 'Comics'),
  'tcj.com':                 t('The Comics Journal', 'Comics'),
  // Gaming: emulation, decomps / native ports, modding, retro
  'dolphin-emu.org':  t('Dolphin Emulator', 'Gaming'),
  'pcsx2.net':        t('PCSX2', 'Gaming'),
  'rpcs3.net':        t('RPCS3', 'Gaming'),
  'github.com/xemu-project/xemu':       t('xemu Releases', 'Gaming'),
  'github.com/HarbourMasters/Shipwright': t('Ship of Harkinian Releases', 'Gaming'),
  'github.com/open-goal/jak-project':   t('OpenGOAL Releases', 'Gaming'),
  'moddb.com':        t('ModDB', 'Gaming'),
  'gbatemp.net':      t('GBAtemp', 'Gaming'),
  'timeextension.com': t('Time Extension', 'Gaming'),
  // Tech: self-hosting, Android
  'selfh.st':          t('selfh.st', 'Tech & Hardware'),
  'tailscale.com':     t('Tailscale Blog', 'Tech & Hardware'),
  'github.com/jellyfin/jellyfin': t('Jellyfin Releases', 'Tech & Hardware'),
  'xda-developers.com': t('XDA Developers', 'Tech & Hardware'),
  'androidpolice.com': t('Android Police', 'Tech & Hardware'),
  'github.com/topjohnwu/Magisk': t('Magisk Releases', 'Tech & Hardware'),
  'github.com/tiann/KernelSU':   t('KernelSU Releases', 'Tech & Hardware'),

  // Official bodies and nonprofits (2026-10-22). UKHSA and UK AISI post on www.gov.uk, shared by every UK
  // department, so they have no key here: their items take their feed's own tag (tagSource).
  // Security
  'nsa.gov':          t('NSA', 'Security'),
  'ic3.gov':          t('FBI IC3', 'Security'),
  'csrc.nist.gov':    t('NIST CSRC', 'Security'),
  'kb.cert.org':      t('CERT/CC', 'Security'),
  'ncsc.gov.uk':      t('UK NCSC', 'Security'),
  'cyber.gc.ca':      t('Canadian Centre for Cyber Security', 'Security'),
  'cyber.gov.au':     t('ACSC', 'Security'),
  'enisa.europa.eu':  t('ENISA', 'Security'),
  'consumer.ftc.gov': t('FTC Consumer Alerts', 'Security'),
  'citizenlab.ca':    t('Citizen Lab', 'Security'),
  // Health
  'ema.europa.eu':    t('EMA', 'Health'),
  'canada.ca/en/health-canada': t('Health Canada', 'Health'),
  'fsis.usda.gov':    t('USDA FSIS', 'Health'),
  'cpsc.gov':         t('CPSC', 'Health'),
  'cms.gov':          t('CMS', 'Health'),
  'samhsa.gov':       t('SAMHSA', 'Health'),
  'cochrane.org':     t('Cochrane', 'Health'),
  'kffhealthnews.org': t('KFF Health News', 'Health'),
  // Science & Space (NOAA's hurricane office goes to Weather & Disasters below)
  'esa.int':          t('ESA', 'Science & Space'),
  'noaa.gov':         t('NOAA', 'Science & Space'),
  'nsf.gov':          t('NSF', 'Science & Space'),
  'jpl.nasa.gov':     t('NASA JPL', 'Science & Space'),
  'nist.gov':         t('NIST', 'Science & Space'),
  'science.org':      t('Science (AAAS)', 'Science & Space'),
  'smithsonianmag.com': t('Smithsonian Magazine', 'Science & Space'),
  'nationalacademies.org': t('National Academies', 'Science & Space'),
  // Weather & Disasters
  'api.weather.gov':  t('NWS', 'Weather & Disasters'),
  'nhc.noaa.gov':     t('NHC', 'Weather & Disasters'),
  'earthquake.usgs.gov': t('USGS Earthquakes', 'Weather & Disasters'),
  'fema.gov':         t('FEMA', 'Weather & Disasters'),
  // US Politics
  'federalregister.gov': t('Federal Register', 'US Politics'),
  'gao.gov':          t('GAO', 'US Politics'),
  'cbo.gov':          t('CBO', 'US Politics'),
  'congress.gov':     t('Congress.gov', 'US Politics'),
  'supremecourt.gov': t('Supreme Court', 'US Politics'),
  'opensecrets.org':  t('OpenSecrets', 'US Politics'),
  'factcheck.org':    t('FactCheck.org', 'US Politics'),
  'ballotpedia.org':  t('Ballotpedia', 'US Politics'),
  'propublica.org':   t('ProPublica', 'US Politics'),
  // World News
  'news.un.org':      t('UN News', 'World News'),
  'reliefweb.int':    t('ReliefWeb', 'World News'),
  'state.gov':        t('State Department', 'World News'),
  'ec.europa.eu':     t('European Commission', 'World News'),
  'nato.int':         t('NATO', 'World News'),
  'icrc.org':         t('ICRC', 'World News'),
  'hrw.org':          t('Human Rights Watch', 'World News'),
  'amnesty.org':      t('Amnesty International', 'World News'),
  'cfr.org':          t('CFR', 'World News'),
  // Business & Finance
  'federalreserve.gov': t('Federal Reserve', 'Business & Finance'),
  'sec.gov':          t('SEC', 'Business & Finance'),
  'bls.gov':          t('BLS', 'Business & Finance'),
  'bea.gov':          t('BEA', 'Business & Finance'),
  'treasury.gov':     t('Treasury', 'Business & Finance'),
  'ftc.gov':          t('FTC', 'Business & Finance'),
  'consumerfinance.gov': t('CFPB', 'Business & Finance'),
  'fdic.gov':         t('FDIC', 'Business & Finance'),
  'imf.org':          t('IMF', 'Business & Finance'),
  'worldbank.org':    t('World Bank', 'Business & Finance'),
  'oecd.org':         t('OECD', 'Business & Finance'),
  'ecb.europa.eu':    t('ECB', 'Business & Finance'),
  'bankofengland.co.uk': t('Bank of England', 'Business & Finance'),
  'brookings.edu':    t('Brookings', 'Business & Finance'),
  'nber.org':         t('NBER', 'Business & Finance'),
  // Tech & Hardware
  'fcc.gov':          t('FCC', 'Tech & Hardware'),
  'linuxfoundation.org': t('Linux Foundation', 'Tech & Hardware'),
  'blog.mozilla.org': t('Mozilla', 'Tech & Hardware'),
  'w3.org':           t('W3C', 'Tech & Hardware'),
  'ietf.org':         t('IETF', 'Tech & Hardware'),
  'icann.org':        t('ICANN', 'Tech & Hardware'),
  'internetsociety.org': t('Internet Society', 'Tech & Hardware'),
  // AI & LLMs (arxiv.org is already tagged arXiv in the generated map)
  'hai.stanford.edu': t('Stanford HAI', 'AI & LLMs'),
  'metr.org':         t('METR', 'AI & LLMs'),
  'allenai.org':      t('Ai2', 'AI & LLMs'),
  'partnershiponai.org': t('Partnership on AI', 'AI & LLMs'),
  'ainowinstitute.org': t('AI Now Institute', 'AI & LLMs'),
  // Gaming
  'theesa.com':       t('Entertainment Software Association', 'Gaming'),
  'gamehistory.org':  t('Video Game History Foundation', 'Gaming'),
  // TV & Movies
  'televisionacademy.com': t('Television Academy', 'TV & Movies'),
  'motionpictures.org': t('MPA', 'TV & Movies'),
  'sundance.org':     t('Sundance Institute', 'TV & Movies'),
  // Animation
  'animationguild.org': t('The Animation Guild', 'Animation'),
  // Comics
  'cbldf.org':        t('CBLDF', 'Comics'),
  'comic-con.org':    t('Comic-Con International', 'Comics'),
  'blogs.loc.gov/headlinesandheroes': t('Library of Congress Headlines & Heroes', 'Comics'),
  // Music (billboard.com was Business & Finance in the n8n map)
  'billboard.com':      t('Billboard', 'Music'),
  'rollingstone.com':   t('Rolling Stone Music', 'Music'),
  'pitchfork.com':      t('Pitchfork', 'Music'),
  'stereogum.com':      t('Stereogum', 'Music'),
  'consequence.net':    t('Consequence', 'Music'),
  'nme.com':            t('NME', 'Music'),
  // Bluesky: post links name the account (bsky.app/profile/<handle>/post/…)
  'bsky.app/profile/wario64.bsky.social':    t('Wario64', 'Gaming'),
  'bsky.app/profile/shinobi602.bsky.social': t('Shinobi602', 'Gaming'),
  'bsky.app/profile/playstation.com':        t('PlayStation', 'Gaming'),
  'bsky.app/profile/steampowered.com':       t('Steam', 'Gaming'),
  'bsky.app/profile/konamina.bsky.social':   t('Konami', 'Gaming'),
  'bsky.app/profile/ubisoft.com':            t('Ubisoft', 'Gaming'),
  'bsky.app/profile/bethesda.net':           t('Bethesda', 'Gaming'),
  'bsky.app/profile/cdprojektred.com':       t('CD Projekt Red', 'Gaming'),
  'bsky.app/profile/valvesoftware.com':      t('Valve', 'Gaming'),
  'bsky.app/profile/discussingfilm.net':     t('DiscussingFilm', 'TV & Movies'),
  'bsky.app/profile/culturecrave.co':        t('Culture Crave', 'TV & Movies'),
  'bsky.app/profile/catsuka.bsky.social':    t('Catsuka', 'Animation'),
  'bsky.app/profile/dc.com':                 t('DC Universe', 'TV & Movies'),
  'bsky.app/profile/gamepass.xbox.com':      t('Xbox', 'Gaming'),
  // Comics publishers
  'dc.com':           t('DC.com', 'Comics'),
  'darkhorse.com':    t('Dark Horse Comics', 'Comics'),
  'archiecomics.com': t('Archie Comics', 'Comics'),
  'bsky.app/profile/boom-studios.com':             t('BOOM! Studios', 'Comics'),
  'bsky.app/profile/dynamitecomicshq.bsky.social': t('Dynamite', 'Comics'),
  'bsky.app/profile/idwpublishing.com':            t('IDW Publishing', 'Comics'),
  'bsky.app/profile/fantagraphics.bsky.social':    t('Fantagraphics', 'Comics'),
  'bsky.app/profile/madcavestudios.com':           t('Mad Cave Studios', 'Comics'),
  'bsky.app/profile/skybound.bsky.social':         t('Skybound', 'Comics'),
  // Governments (UK Prime Minister posts on www.gov.uk: tagged by its feed, see feeds.extra.ts)
  'whitehouse.gov':   t('White House', 'US Politics'),
  'bsky.app/profile/ukparliament.parliament.uk':   t('UK Parliament', 'World News'),
  'bsky.app/profile/houseofcommons.parliament.uk': t('UK Parliament', 'World News'),
  'bsky.app/profile/houseoflords.parliament.uk':   t('UK Parliament', 'World News'),
  // Stand-ins for X accounts with no Bluesky (feeds.extra.ts), named like their Sources toggles
  'blogs.microsoft.com':      t('Microsoft', 'Tech & Hardware'),
  'thewaltdisneycompany.com': t('Disney', 'TV & Movies'),
  'marvel.com':               t('Marvel.com', 'Comics'), // its own toggle: Marvel's X account sat in TV & Movies, covered there by Marvel Entertainment on YouTube
  'rockstargames.com':        t('Rockstar Games', 'Gaming'),
  'therundown.ai':            t('Rowan Cheung', 'AI & LLMs'),
  'comicbook.com':            t('ComicBook.com', 'Comics'),
  // Notable Trends
  'pewresearch.org':  t('Pew Research Center', 'Notable Trends'),
  'gallup.com':       t('Gallup', 'Notable Trends'),
};

// YouTube items are tagged by the feed's <author> string.
export const EXTRA_YOUTUBE_AUTHORS: Record<string, SourceTag> = {
  'Bloomberg Originals': t('Bloomberg', 'Business & Finance'),
  'World Health Organization (WHO)': t('WHO', 'Health'),
  'Universal Pictures':          t('Universal Pictures', 'TV & Movies'),
  'Sony Pictures Entertainment': t('Sony Pictures', 'TV & Movies'),
  'Paramount Pictures':          t('Paramount Pictures', 'TV & Movies'),
  'Lionsgate Movies':            t('Lionsgate', 'TV & Movies'),
  'HBO':                         t('HBO', 'TV & Movies'),
  'Sony':                        t('Sony', 'Tech & Hardware'),
};
