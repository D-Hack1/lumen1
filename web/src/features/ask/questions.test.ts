// Owner: Ebin
// A bank of ordinary-language questions, each with the knowledge entry it MUST find (by id or id prefix) among the
// top 3 STRONG matches — and questions it must NOT answer. This is the honest measure of "can Ask LUMEN answer normal
// questions": add a question here whenever someone reports one that failed, then fix the content or tags, not the test.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildIndex, searchKnowledge, type KnowledgeEntry } from './knowledge';

const entries: KnowledgeEntry[] = JSON.parse(readFileSync(resolve(__dirname, '../../../public/content/knowledge.json'), 'utf8')).entries;
const idx = buildIndex(entries);
const strong = (q: string) => searchKnowledge(idx, q, 3).filter((h) => h.confidence === 'strong').map((h) => h.entry.id);

/** [question, acceptable ids or id prefixes] */
const MUST_FIND: readonly [string, readonly string[]][] = [
  // ---- using the interface
  ['how do i compare two sites', ['help:how-do-i-compare-sites']],
  ['how do i zoom the moon', ['help:how-do-i-use-the-orbit-page']],
  ['how do i rotate the globe', ['help:how-do-i-use-the-orbit-page']],
  ['where do i pick a site', ['help:how-do-i-choose-a-landing-site']],
  ['how do i drop a pin', ['help:how-do-i-look-up-my-own-coordinates']],
  ['how do i look up latitude and longitude', ['help:how-do-i-look-up-my-own-coordinates']],
  ['how do i play the timeline', ['help:how-do-i-scrub-or-play']],
  ['what does the array height do', ['help:what-does-the-array-height']],
  ['how do i change to dark mode', ['help:how-do-i-switch-between-light-and-dark']],
  ['what is the slip explorer', ['help:what-is-the-slip-explorer']],
  ['how many days can i slip', ['help:what-is-the-slip-explorer', 'help:how-do-i-slip-the-landing']],
  ['how do i go back to on time', ['help:how-do-i-get-back-to-landing-on', 'help:how-do-i-slip-the-landing']],
  ['how do i get to the compare page', ['help:how-do-i-move-between-pages']],
  ['what does the stand here page show', ['help:what-does-the-stand-here-page-show']],
  ['what do the colours mean', ['help:what-do-the-amber-and-sage-colours-mean']],
  ['what does sets in mean', ['help:what-does-sets-in']],
  ['how do i use this box', ['help:how-do-i-use-ask-lumen']],
  ['what are the numbers for this window', ['help:what-are-numbers-for-this-window']],
  ['what is the methodology page', ['help:what-is-the-methodology-page']],
  ['what is the details section', ['help:what-is-the-details-section-on-stand-here']],
  ['how do i export the windows table', ['help:how-do-i-export-the-windows-table']],
  ['how many validation gates pass', ['help:what-do-the-validation-gates-mean']],
  ['can i click a chart to move through time', ['help:can-i-click-a-chart-to-move-through-time']],
  ['what does the why button do', ['help:what-does-the-why-button-next-to-a-number-do']],
  ['what does sigma pending mean', ['help:why-is-there-no']],
  ['why is there no plus minus', ['help:why-is-there-no', 'term:uncertainty']],
  ['what does smooth moon mean', ['help:what-does-smooth-moon-mean-on-a-site']],
  ['what can i ask you', ['help:how-do-i-use-ask-lumen', 'help:what-questions-can-lumen-answer']],
  // ---- how results are calculated
  ['how are the results calculated', ['help:how-does-lumen-work']],
  ['how does lumen work', ['help:how-does-lumen-work']],
  ['how is the earth elevation calculated', ['help:how-is-earth-elevation-calculated']],
  ['how do you know the sun position', ['help:how-is-sun-elevation-calculated']],
  ['how is sunlight calculated', ['help:how-is-the-sunlit-percentage-calculated']],
  ['how is the link to earth decided', ['help:how-is-the-link-to-earth-decided']],
  ['how is power calculated', ['help:how-is-solar-power-estimated']],
  ['how is slope calculated', ['help:how-is-the-pad-slope-computed']],
  ['how is the longest night found', ['help:how-is-the-longest-night-calculated', 'term:longest-night']],
  ['how is the verdict decided', ['help:how-is-the-verdict-go-marginal-no-go-decided']],
  ['how are shadows computed', ['help:how-does-lumen-handle-shadows']],
  ['what is a horizon mask', ['help:what-is-a-horizon-mask']],
  ['how long does the signal take', ['help:what-is-the-earth-moon-light-time']],
  ['how is the plus minus on a sunset time calculated', ['help:how-is-the-on-an-event-time-calculated']],
  ['where does the data come from', ['help:where-does-lumen']],
  ['does it work offline', ['help:does-lumen-need-an-internet-connection']],
  ['what are the tiers', ['help:what-are-the-fidelity-tiers-a-b-and-c', 'term:fidelity-tier']],
  // ---- why decisions / why it behaves this way
  ['why is this ± so big', ['term:uncertainty', 'decision:R2-7', 'help:why-does-lumen-show-a', 'help:why-is-the-timing-uncertainty-hours-not-minutes', 'help:how-is-the-on-an-event-time-calculated']],
  ['why is the timing so uncertain', ['help:why-is-the-timing-uncertainty', 'term:uncertainty', 'decision:R2-7']],
  ['why do you show plus minus on everything', ['help:why-does-lumen-show-a']],
  ['why does the sun stay so low', ['help:why-does-the-sun-skim-the-horizon-at-the-poles']],
  ['why does earth wobble', ['help:why-does-the-earth-bob-up-and-down-near-the-horizon']],
  ['why is mast height important', ['help:why-does-a-taller-mast-change-the-result', 'help:what-does-the-array-height']],
  ['why did you put sun elevation first', ['help:why-does-the-sun-elevation-come-first-on-the-screen']],
  ['what do my definitions change', ['help:how-do-my-definitions-change-the-results']],
  ['why did we choose a windows table', ['decision:R2-8']],
  ['why is there an earth twin', ['decision:R2-4', 'help:what-is-the-earth-twin']],
  ['is there an atmosphere on the moon', ['help:is-there-twilight-or-atmosphere-on-the-moon']],
  // ---- background / definitions
  ['what is libration', ['term:libration']],
  ['what does grazing mean', ['term:grazing-event']],
  ['what is dte', ['help:what-is-dte-direct-to-earth', 'term:dte-margin']],
  ['what is a dsn station', ['help:what-is-the-deep-space-network']],
  ['what is psr', ['help:what-is-a-permanently-shadowed-region-psr', 'term:distance-to-psr']],
  ['what does lumen not do', ['help:what-does-lumen-not-calculate']],
  ['who is this tool for', ['help:what-questions-can-lumen-answer']],
  ['are these numbers real', ['help:are-the-numbers-on-the-pages-real']],
  ['how accurate is this', ['help:are-the-numbers-on-the-pages-real', 'help:how-was-lumen-checked-and-how-do-i-know-it-is-right']],
  ['how do you know it is validated', ['help:how-was-lumen-checked-and-how-do-i-know-it-is-right']],
];

/** For these the RIGHT answer must be the very first strong hit, not just somewhere in the top 3. */
const MUST_BE_FIRST: readonly [string, string][] = [
  ['why did you choose to show a plus minus', 'help:why-does-lumen-show-a'],
  ['why do you show plus minus on everything', 'help:why-does-lumen-show-a'],
  ['how is the earth elevation calculated', 'help:how-is-earth-elevation-calculated'],
  ['how do i compare two sites', 'help:how-do-i-compare-sites'],
  ['how are the results calculated', 'help:how-does-lumen-work'],
  ['what is libration', 'term:libration'],
  ['what does sigma pending mean', 'help:why-is-there-no'],
  ['how is sunlight calculated', 'help:how-is-the-sunlit-percentage-calculated'],
  ['are these numbers real', 'help:are-the-numbers-on-the-pages-real'],
];

/** Things the knowledge file does not cover. It must NOT present any of these as a confident answer. */
const MUST_NOT_ANSWER: readonly string[] = ['banana smoothie recipe', 'what is the capital of france', 'who won the football match', 'how do i bake sourdough bread', 'what is the weather tomorrow'];

describe('ordinary questions find the right answer (top 3 strong matches)', () => {
  for (const [q, ids] of MUST_FIND) {
    it(q, () => {
      const got = strong(q);
      expect(got.some((g) => ids.some((id) => g.startsWith(id))), `got: ${got.join(', ') || '(nothing strong)'}`).toBe(true);
    });
  }
});

describe('the most common questions get the right answer FIRST', () => {
  for (const [q, id] of MUST_BE_FIRST) it(q, () => expect(strong(q)[0]).toBe(id.startsWith('help:') || id.startsWith('term:') ? strong(q).find((g) => g.startsWith(id)) : id));
});

describe('questions outside what LUMEN knows are not answered with confidence', () => {
  for (const q of MUST_NOT_ANSWER) it(q, () => expect(strong(q)).toEqual([]));
});

describe('coverage', () => {
  it('every how-to and method entry is findable by its own title', () => {
    for (const e of entries.filter((x) => x.kind === 'howto' || x.kind === 'method')) {
      const got = strong(e.title.replace(/[?]/g, ''));
      expect(got, `entry "${e.title}" cannot be found by its own title`).toContain(e.id);
    }
  });
});
