// AI Writer → Local AI: what someone needs to run the digest on their own computer without knowing Ollama.
// Is it installed and running (start it if not), which models are downloaded, download one with progress,
// and a test that shows what the chosen model writes and how fast. The speed it measures feeds the run forecast.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataDir, env } from './env.js';
import { llmFetch } from './pipeline/llm/http.js';
import { checkSummary, fromFeed, limitFor, storyMessages, storyText } from './pipeline/llm/local.js';
import { chatWith, showModel } from './pipeline/llm/ollama.js';
import { LLMError } from './pipeline/llm/types.js';
import type { Item } from './pipeline/types.js';

export interface LocalModel {
  name: string;
  sizeBytes: number;
  parameters: string | null;
  quantization: string | null;
  contextLength: number | null;
}

export interface Suggestion { name: string; label: string; sizeGb: number; minRamGb: number; note: string }

/** Small instruct models that work with NetRunner's local writer (tags checked on ollama.com, 2026-10-22). */
export const SUGGESTED: Suggestion[] = [
  { name: 'smollm2:1.7b-instruct-q4_K_M', label: 'SmolLM2 1.7B', sizeGb: 1.1, minRamGb: 6, note: 'Smallest and fastest. Fine on an 8 GB laptop.' },
  { name: 'qwen2.5:3b', label: 'Qwen 2.5 3B', sizeGb: 1.9, minRamGb: 8, note: 'Better writing, roughly half the speed.' },
  { name: 'llama3.2:3b', label: 'Llama 3.2 3B', sizeGb: 2.0, minRamGb: 8, note: 'Better writing, roughly half the speed.' },
  { name: 'gemma3:4b', label: 'Gemma 3 4B', sizeGb: 3.4, minRamGb: 12, note: 'The best writer of these. Wants 16 GB of memory.' },
];

/** Ollama model names: "smollm2:1.7b-instruct-q4_K_M", "llama3.2", "hf.co/user/repo:Q4_K_M". */
export const MODEL_NAME = /^[a-z0-9][\w.-]*(?:\/[\w.-]+)*(?::[\w.-]+)?$/i;

/** "llama3.2" and "llama3.2:latest" are the same model to Ollama. */
export const sameModel = (a: string, b: string) => {
  const full = (n: string) => (n.includes(':') ? n : `${n}:latest`).toLowerCase();
  return full(a) === full(b);
};

const base = () => env().OLLAMA_URL.replace(/\/$/, '');

/** Ollama on this computer (not on another machine, a Pi or a Docker host): only then can NetRunner start it. */
export function isThisComputer(url = env().OLLAMA_URL): boolean {
  try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname); } catch { return false; }
}

/** Where the Ollama app is installed, if it is (Windows and macOS have an app that starts the server). */
export function ollamaApp(): string | null {
  const candidates = process.platform === 'win32'
    ? [path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Ollama', 'ollama app.exe')]
    : process.platform === 'darwin' ? ['/Applications/Ollama.app'] : [];
  return candidates.find(p => p && fs.existsSync(p)) ?? null;
}

async function getJson(p: string, ms: number): Promise<any> {
  const res = await fetch(`${base()}${p}`, { signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Downloading a model ───────────────────────────────────────────────────────────────────────────────

export interface PullState { name: string; status: string; completed: number; total: number; done: boolean; error?: string }
let pull: PullState | null = null;

/** Starts downloading a model; one at a time. Progress: pullState(). */
export function startPull(name: string, fetchImpl: typeof fetch = fetch): PullState {
  if (!MODEL_NAME.test(name) || name.length > 200) throw Object.assign(new Error(`"${name}" isn't a model name (e.g. llama3.2:3b)`), { statusCode: 400 });
  if (pull && !pull.done) throw Object.assign(new Error(`Already downloading ${pull.name}`), { statusCode: 409 });
  const state: PullState = { name, status: 'starting', completed: 0, total: 0, done: false };
  pull = state;
  void (async () => {
    try {
      const res = await fetchImpl(`${base()}/api/pull`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: name, stream: true }) });
      if (!res.ok || !res.body) throw new Error((await res.text().catch(() => '')).slice(0, 200) || `HTTP ${res.status}`);
      // One JSON line per update; a model is several files ("layers"), each with its own total.
      const layers = new Map<string, { total: number; completed: number }>();
      const decoder = new TextDecoder();
      let buf = '';
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buf += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const j = JSON.parse(line);
          if (j.error) throw new Error(j.error);
          state.status = j.status ?? state.status;
          if (j.digest && j.total) layers.set(j.digest, { total: j.total, completed: j.completed ?? 0 });
          state.total = [...layers.values()].reduce((a, l) => a + l.total, 0);
          state.completed = [...layers.values()].reduce((a, l) => a + l.completed, 0);
        }
      }
      if (state.status !== 'success') throw new Error(`the download ended early (${state.status})`);
    } catch (e) {
      state.error = /file does not exist|not found/i.test((e as Error).message)
        ? `Ollama has no model called ${name}. Check the name on ollama.com/library.` : (e as Error).message;
    } finally {
      state.done = true;
    }
  })();
  return state;
}

export const pullState = () => pull;

// ── Status ────────────────────────────────────────────────────────────────────────────────────────────

export async function localAiStatus() {
  const e = env();
  const ramGb = Math.round(os.totalmem() / 2 ** 30 * 10) / 10;
  let version: string | null = null;
  let models: LocalModel[] = [];
  try {
    version = (await getJson('/api/version', 3000))?.version ?? null;
    models = ((await getJson('/api/tags', 5000))?.models ?? []).map((m: any): LocalModel => ({
      name: m.name,
      sizeBytes: m.size ?? 0,
      parameters: m.details?.parameter_size ?? null,
      quantization: m.details?.quantization_level ?? null,
      contextLength: m.details?.context_length ?? null,
    }));
  } catch { /* not running, or not there */ }
  const app = ollamaApp();
  return {
    url: e.OLLAMA_URL,
    thisComputer: isThisComputer(),
    running: !!version,
    version,
    /** true / false on this computer; null when Ollama is elsewhere and not answering (can't tell). */
    installed: version ? true : isThisComputer() ? !!app : null,
    canStart: !version && !!app && isThisComputer(),
    models,
    chosen: e.OLLAMA_MODEL,
    chosenInstalled: models.some(m => sameModel(m.name, e.OLLAMA_MODEL)),
    ramGb,
    suggested: SUGGESTED.map(s => ({ ...s, installed: models.some(m => sameModel(m.name, s.name)), fits: ramGb >= s.minRamGb })),
    pull,
    speed: savedSpeed(),
  };
}

/** Opens the Ollama app (which starts its server) and waits for it to answer. */
export async function startOllama(waitMs = 20_000): Promise<{ running: boolean }> {
  const app = ollamaApp();
  if (!app || !isThisComputer()) throw Object.assign(new Error('Ollama can only be started here when it is installed on this computer'), { statusCode: 400 });
  if (process.platform === 'darwin') spawn('open', ['-a', app], { detached: true, stdio: 'ignore' }).unref();
  else spawn(app, [], { detached: true, stdio: 'ignore' }).unref();
  for (const until = Date.now() + waitMs; Date.now() < until;) {
    await new Promise(r => setTimeout(r, 500));
    try { if ((await getJson('/api/version', 1500))?.version) return { running: true }; } catch { /* not yet */ }
  }
  return { running: false };
}

// ── Testing the model ─────────────────────────────────────────────────────────────────────────────────

/** Made-up stories for the test (not news): one long enough that the model has to shorten it. */
const SAMPLES: Item[] = [
  { mode: 'test', source: 'Example News', category: 'Tech & Hardware', id: 'T1', link: '', published: null,
    title: 'City library lends out laptops for the first time',
    summary: 'The Riverside Public Library said Monday it will lend 200 laptops to card holders starting November 3, for up to three weeks at a time. The program is paid for by a $150,000 state grant, and the library plans to add 100 more machines next spring if demand holds up. Staff will also run free classes on Saturdays.' },
  { mode: 'test', source: 'Example Sports', category: 'Gaming', id: 'T2', link: '', published: null,
    title: 'Local team wins regional esports final',
    summary: 'Riverside High School beat five other schools on Sunday to win the regional esports final, its first title since the club started in 2022. The team now goes to the state final in Columbus on December 6, where 16 schools will compete. The coach said the players practice four evenings a week.' },
];

export interface Speed { model: string; secondsPerStory: number; at: string }
const speedFile = () => path.join(dataDir(), 'local-ai.json');

/** The last test's speed (for the run forecast), when it was for the model chosen now. */
export function savedSpeed(): Speed | null {
  try {
    const s = JSON.parse(fs.readFileSync(speedFile(), 'utf8')) as Speed;
    return sameModel(s.model, env().OLLAMA_MODEL) && s.secondsPerStory > 0 ? s : null;
  } catch { return null; }
}

/**
 * Runs the model on the two sample stories, as a digest would: what it wrote (and whether NetRunner would use
 * it), how long loading took, and seconds per story once loaded.
 */
export async function testModel(summaryLength = '2-3', fetchImpl: typeof fetch = llmFetch) {
  const model = env().OLLAMA_MODEL;
  const signal = AbortSignal.timeout(300_000);
  let info;
  try { info = await showModel(fetchImpl, model, signal); } catch (e) {
    throw Object.assign(new Error(e instanceof LLMError && e.status === 404 ? `${model} isn't downloaded yet: download it first.`
      : /ECONNREFUSED|unreachable/.test((e as Error).message) ? "Ollama isn't running." : (e as Error).message), { statusCode: 400 });
  }
  const chat = chatWith(fetchImpl, model, info, 4096);
  const limit = limitFor(summaryLength);
  const results = [];
  for (const item of SAMPLES) {
    const text = storyText(item);
    const t0 = Date.now();
    const answer = await chat(storyMessages(item, text, limit), limit.maxTokens, signal);
    const kept = checkSummary(answer, item, text, limit);
    results.push({ title: item.title, text, answer, used: kept ?? fromFeed(text, limit), passed: !!kept, ms: Date.now() - t0 });
  }
  // The first request also loads the model; the second shows the speed during a digest.
  const secondsPerStory = Math.round(results[1].ms / 100) / 10;
  const speed: Speed = { model, secondsPerStory, at: new Date().toISOString() };
  try { fs.writeFileSync(speedFile(), JSON.stringify(speed)); } catch { /* the forecast falls back to a guess */ }
  return { model, loadSeconds: Math.max(0, Math.round((results[0].ms - results[1].ms) / 100) / 10), secondsPerStory, results };
}
