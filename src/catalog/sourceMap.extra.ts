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
};

// YouTube items are tagged by the feed's <author> string.
export const EXTRA_YOUTUBE_AUTHORS: Record<string, SourceTag> = {
  'Bloomberg Originals': t('Bloomberg', 'Business & Finance'),
};
