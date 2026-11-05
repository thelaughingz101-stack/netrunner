import { describe, expect, it } from 'vitest';
import { capSummaries } from '../src/pipeline/summaries.js';

describe('Format → Summary length, enforced after writing', () => {
  const two = '- [**Headline**](https://x.dev/a) — First sentence about it. Second sentence, more detail. *(IGN)*';
  it('cuts a summary longer than the setting at a sentence end, and leaves shorter ones and EXCLUDED lines alone', () => {
    expect(capSummaries(two, '1')).toEqual({ md: '- [**Headline**](https://x.dev/a) — First sentence about it. *(IGN)*', cut: 1 });
    expect(capSummaries(two, '2-3')).toEqual({ md: two, cut: 0 });
    const excluded = '- Some story (IGN) — reason: filler. Really. Truly.';
    expect(capSummaries(excluded, '1').cut).toBe(0);
    expect(capSummaries('- **Linkless** — Dr. Smith spoke. Then left. *(AP)*', '1').md).toBe('- **Linkless** — Dr. Smith spoke. *(AP)*');
  });
});
