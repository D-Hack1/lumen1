// Owner: Ebin
// Builds web/public/content/knowledge.json — the offline knowledge file behind "Ask LUMEN" (Explain).
// Sources (all already in the repo, nothing invented here):
//   • web/public/content/glossary.json          terms (definition, formula, impact, uncertainty)
//   • docs/validation.md, docs/limitations.md   gate results and known limits (split on "## ")
//   • docs/ask_help.md                          plain-language how-to / how-it's-calculated / why-we-decided answers
//   • plan/PLAN_FINAL*.md "Revision 2 changelog" the decision log: what changed and WHY
// Excluded on purpose: anything that mentions Shackleton (its mask/coordinates are under review — Nived, Nov 15).
// Run from web/:  node scripts/build-knowledge.mjs        (re-run whenever those sources change)
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '..');
const repo = resolve(web, '..');
const EXCLUDE = /shackleton/i;

const clean = (s) => s.replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim();
const entries = [];
const add = (e) => {
  if (EXCLUDE.test(`${e.title} ${e.summary} ${e.body}`)) return;
  entries.push(e);
};

// ---- glossary
const glossary = JSON.parse(readFileSync(join(web, 'public/content/glossary.json'), 'utf8'));
for (const g of glossary.entries ?? []) {
  add({
    id: `term:${g.id}`,
    kind: 'term',
    title: g.term,
    summary: g.definition,
    body: clean([g.definition, g.impact, g.formula && `Formula: ${g.formula}`, g.uncertainty && `Caveat: ${g.uncertainty}`].filter(Boolean).join(' ')),
    source: g.source ?? 'glossary',
    anchor: g.learn_more_anchor ?? `gloss-${g.id}`,
    metrics: g.related_metric_ids ?? [],
  });
}

// ---- docs: one entry per "## " section
function sections(file, kind, sourceName) {
  const p = join(repo, 'docs', file);
  if (!existsSync(p)) return;
  const text = readFileSync(p, 'utf8');
  for (const part of text.split(/^## /m).slice(1)) {
    const [head, ...rest] = part.split('\n');
    const body = clean(rest.join(' '));
    if (!body) continue;
    const slug = clean(head).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    add({ id: `${kind}:${slug}`, kind, title: clean(head), summary: body.slice(0, 240), body, source: sourceName, anchor: slug, metrics: [] });
  }
}
sections('validation.md', 'validation', 'docs/validation.md');
sections('limitations.md', 'limitation', 'docs/limitations.md');

// ---- docs/ask_help.md: "## Question" + Kind:/Source:/Tags: lines + the answer
const KINDS = new Set(['howto', 'method', 'decision', 'concept', 'status']);
{
  const p = join(repo, 'docs', 'ask_help.md');
  if (existsSync(p)) {
    for (const part of readFileSync(p, 'utf8').split(/^## /m).slice(1)) {
      const [head, ...lines] = part.split(/\r?\n/);
      const meta = {};
      const body = [];
      for (const ln of lines) {
        const m = ln.match(/^(Kind|Source|Tags):\s*(.*)$/);
        if (m && body.length === 0) meta[m[1].toLowerCase()] = m[2].trim();
        else body.push(ln);
      }
      const answer = clean(body.join(' '));
      const kind = KINDS.has(meta.kind) ? meta.kind : 'howto';
      if (!answer) continue;
      const slug = clean(head).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);
      add({
        id: `help:${slug}`,
        kind,
        title: clean(head),
        summary: answer,
        body: answer,
        source: meta.source ?? 'docs/ask_help.md',
        anchor: slug,
        metrics: [],
        tags: (meta.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean),
      });
    }
  }
}

// ---- decision log: the plan's Revision 2 changelog table  |R2-n| Change | Why | Where |
const planFile = readdirSync(join(repo, 'plan')).find((f) => /^PLAN_FINAL.*\.md$/.test(f));
if (planFile) {
  for (const line of readFileSync(join(repo, 'plan', planFile), 'utf8').split('\n')) {
    const m = line.match(/^\|\s*(R2-\d+)\s*\|(.+?)\|(.+?)\|(.+?)\|\s*$/);
    if (!m) continue;
    const [, id, change, why, where] = m;
    add({
      id: `decision:${id}`,
      kind: 'decision',
      title: clean(change).slice(0, 120),
      summary: `Why: ${clean(why)}`,
      body: `${clean(change)} Why: ${clean(why)}`,
      source: `PLAN_FINAL, Revision 2 changelog ${id} (${clean(where)})`,
      anchor: id.toLowerCase(),
      metrics: [],
    });
  }
}

const out = { version: '1', generated: 'by web/scripts/build-knowledge.mjs', count: entries.length, entries };
// KNOWLEDGE_OUT lets the "is knowledge.json up to date?" test build into a temp file without touching the real one.
writeFileSync(process.env.KNOWLEDGE_OUT ?? join(web, 'public/content/knowledge.json'), JSON.stringify(out, null, 1) + '\n');
const byKind = entries.reduce((a, e) => ({ ...a, [e.kind]: (a[e.kind] ?? 0) + 1 }), {});
console.log(`knowledge.json: ${entries.length} entries`, byKind);
