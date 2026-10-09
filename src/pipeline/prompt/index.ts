// Typed entry points to the verbatim n8n prompt builders in ./generated.
import type { Config } from '../../config/schema.js';
import type { Item } from '../types.js';
import { run as runBuildLlmPayload } from './generated/buildLlmPayload.js';
import { run as runChatgpt } from './generated/exportChatgpt.js';
import { run as runClaude } from './generated/exportClaude.js';
import { run as runGemini } from './generated/exportGemini.js';
import { run as runGrok } from './generated/exportGrok.js';
import { run as runDeepseek } from './generated/exportDeepseek.js';

/** What n8n's Topic Toggles node handed to Build LLM Payload / the export nodes. */
export interface PromptInput {
  mode: string;
  items: Item[];
  morningDigest: string;
}

export interface GeminiBody {
  systemInstruction: { parts: { text: string }[] };
  contents: { role: string; parts: { text: string }[] }[];
  tools?: unknown[];
  generationConfig: Record<string, unknown>;
}

/** Same request every tier gets: Gemini's body verbatim; Claude/Ollama derive from it (as in n8n). */
export interface DigestPrompt {
  mode: string;
  geminiBody: GeminiBody;
  system: string;
  user: string;
}

export const promptFromGeminiBody = (mode: string, geminiBody: GeminiBody): DigestPrompt => ({
  mode,
  geminiBody,
  system: geminiBody.systemInstruction.parts[0].text,
  user: geminiBody.contents[0].parts[0].text,
});

export function buildLlmPayload(input: PromptInput, config: Config, developing: string[]): DigestPrompt {
  const [{ json }] = runBuildLlmPayload(input, {
    'Parse Config': { config },
    // n8n read this from a node that ran AFTER Build LLM Payload, so it was always empty.
    // We compute it before building the prompt (CHANGES_FROM_N8N.md → developing stories).
    'Story Tracker': { developing },
  });
  return promptFromGeminiBody(json.mode, json.geminiBody);
}

export type ExportPlatform = 'chatgpt' | 'claude' | 'gemini' | 'grok' | 'deepseek';
const EXPORTERS: Record<ExportPlatform, typeof runChatgpt> = {
  chatgpt: runChatgpt, claude: runClaude, gemini: runGemini, grok: runGrok, deepseek: runDeepseek,
};

export interface ManualOutput {
  mode: string;
  digest: string;
  howToUse: string;
  systemInstructions: string;
  userRequest: string;
  date: string;
}

/** Switch (Platform) → digest_export_[X] → Format Manual Output. Unknown platforms (e.g. the
 *  retired "notebooklm") hit the Switch's fallback output, which went to the ChatGPT exporter. */
export function buildManualPrompt(input: PromptInput, config: Config, today: string): ManualOutput {
  const platform = config.delivery.chatbotPlatform || 'chatgpt';
  const exporter = EXPORTERS[platform as ExportPlatform] ?? EXPORTERS.chatgpt;
  const [{ json: data }] = exporter(input, { 'Parse Config': { config } });
  // Format Manual Output (verbatim mapping). Date uses the configured timezone, not UTC.
  return {
    mode: `manual-${platform}`,
    digest: data.content || '(no prompt generated)',
    howToUse: data.howToUse || '',
    systemInstructions: data.systemInstructions || '',
    userRequest: data.userRequest || '',
    date: today,
  };
}
