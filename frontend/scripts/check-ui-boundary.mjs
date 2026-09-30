/**
 * UI boundary check — Tailwind utilities may appear ONLY inside shared
 * primitives (`src/components/ui/**` and `src/components/layout/**`).
 *
 * Pages and feature components must compose shared components
 * (Container / Stack / Flex / Grid / PageShell / Input / Button / Card / …)
 * and pass props — never raw Tailwind classNames, hand-rolled SVGs for
 * built-in behaviors, or per-page layout CSS.
 *
 * Usage:
 *   node scripts/check-ui-boundary.mjs            # fail on NEW violations
 *   node scripts/check-ui-boundary.mjs --update-baseline   # accept current state
 *
 * Baseline: scripts/ui-boundary-baseline.json (per-file sorted token lists).
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const baselinePath = join(dirname(fileURLToPath(import.meta.url)), 'ui-boundary-baseline.json');

const ALLOWED_DIRS = ['components' + sep + 'ui', 'components' + sep + 'layout'];

// Full-token Tailwind utility patterns (checked AFTER stripping variant prefixes).
// Enumerated exactly — open-ended families (e.g. `content-*`) false-positive
// on custom classes like `.content-area`, so values are listed explicitly.
const UTILITY_PATTERNS = [
  /^(flex|inline-flex|grid|inline-grid|block|inline-block|inline|hidden|contents|flow-root|isolate)$/,
  /^flex-(row|row-reverse|col|col-reverse|wrap|wrap-reverse|nowrap|1|auto|initial|none)$/,
  /^(grow|grow-0|shrink|shrink-0)$/,
  /^order-(first|last|none|\d+)$/,
  /^(basis|col-span|row-span|col-start|col-end|row-start|row-end)-(\d+|auto|full|\[.+\])$/,
  /^grid-(cols|rows)-(\d+|none|subgrid|\[.+\])$/,
  /^auto-(cols|rows)-(auto|min|max|fr|\[.+\])$/,
  /^gap-(\d+|px|\[.+\])$/,
  /^gap-[xy]-(0|px|\d+|\[.+\])$/,
  /^space-[xy]-(0|px|\d+|\[.+\]|reverse)$/,
  /^divide-[xy](-.+)?$/,
  /^items-(start|end|center|baseline|stretch)$/,
  /^justify-(normal|start|end|center|between|around|evenly|stretch)$/,
  /^justify-(items|self)-(start|end|center|stretch)$/,
  /^content-(normal|center|start|end|between|around|evenly|baseline|stretch)$/,
  /^place-content-(center|start|end|between|around|evenly|baseline|stretch)$/,
  /^place-items-(start|end|center|baseline|stretch)$/,
  /^place-self-(auto|start|end|center|stretch)$/,
  /^self-(auto|start|end|center|stretch|baseline)$/,
  /^[mp][trblxy]?-(0|px|auto|\d+|\[.+\])$/,
  /^(w|h|min-w|min-h|max-w|max-h|size)-(0|px|auto|full|screen|\d+|\[.+\]|1\/2|1\/3|2\/3|1\/4|3\/4|1\/5|2\/5|3\/5|4\/5|1\/6|5\/6|1\/12|5\/12|7\/12|11\/12|fit|max|min)$/,
  /^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl|left|center|right|justify|start|end|ellipsis|clip|wrap|nowrap|balance|pretty|\[.+\])$/,
  /^text-(foreground|background|card|card-foreground|popover|popover-foreground|primary|primary-foreground|secondary|secondary-foreground|muted|muted-foreground|accent|accent-foreground|destructive|destructive-foreground|border|input|ring|chart-[1-5]|current|inherit|transparent|white|black)(\/\d+)?$/,
  /^font-(sans|serif|mono|thin|extralight|light|normal|medium|semibold|bold|extrabold|black|\[.+\])$/,
  /^leading-(none|tight|snug|normal|relaxed|loose|\d+|\[.+\])$/,
  /^tracking-(tighter|tight|normal|wide|wider|widest|\[.+\])$/,
  /^bg-.+$/,
  /^border(-.+)?$/,
  /^rounded(-.+)?$/,
  /^shadow-.+$/,
  /^ring(-.+)?$/,
  /^outline-.+$/,
  /^opacity-(0|5|10|15|20|25|30|35|40|45|50|55|60|65|70|75|80|85|90|95|100|\[.+\])$/,
  /^(absolute|relative|fixed|sticky|static)$/,
  /^(inset(-[xy])?|top|right|bottom|left|start|end)-(0|px|auto|full|\d+|\[.+\]|1\/2|1\/3|2\/3|1\/4|3\/4)$/,
  /^z-(0|10|20|30|40|50|auto|\[.+\])$/,
  /^overflow(-[xy])?-(auto|hidden|clip|visible|scroll)$/,
  /^(truncate|whitespace-(normal|nowrap|pre|pre-line|pre-wrap|break-spaces)|break-(normal|words|all|keep))$/,
  /^hyphens-(none|manual|auto)$/,
  /^cursor-(auto|default|pointer|wait|text|move|help|not-allowed|none|context-menu|progress|cell|crosshair|vertical-text|alias|copy|no-drop|grab|grabbing|all-scroll|col-resize|row-resize)$/,
  /^pointer-events-(none|auto)$/,
  /^select-(none|text|all|auto)$/,
  /^resize(-(none|y|x|both))?$/,
  /^(visible|invisible)$/,
  /^(underline|overline|line-through|no-underline)$/,
  /^(uppercase|lowercase|capitalize|normal-case)$/,
  /^(italic|not-italic)$/,
  /^(ordinal|slashed-zero|lining-nums|oldstyle-nums|proportional-nums|tabular-nums|diagonal-fractions|stacked-fractions)$/,
  /^transition(-(none|all|colors|opacity|shadow|transform)|\[.+\])?$/,
  /^(duration|delay)-(\d+|\[.+\])$/,
  /^ease-(linear|in|out|in-out|\[.+\])$/,
  /^animate-(spin|ping|pulse|bounce|\[.+\])$/,
  /^aspect-(auto|square|video|\[.+\]|(\d+\/\d+))$/,
  /^object-(contain|cover|fill|none|scale-down|\[.+\])$/,
  /^align-(baseline|top|middle|bottom|text-top|text-bottom|sub|super)$/,
  /^list-(none|disc|decimal|inside|outside|\[.+\])$/,
  /^caption-(top|bottom)$/,
  /^(table-auto|table-fixed|border-collapse|border-separate)$/,
  /^(sr-only|not-sr-only)$/,
  /^(antialiased|subpixel-antialiased)$/,
  /^(caret|accent)-.+$/,
  /^(blur|brightness|contrast|grayscale|hue-rotate|invert|saturate|sepia)-.+$/,
  /^drop-shadow(-(sm|md|lg|xl|2xl|\[.+\]))?$/,
  /^filter$/,
  /^backdrop-.+$/,
  /^(mix-blend|bg-blend)-.+$/,
  /^(float|clear)-(start|end|right|left|none)$/,
  /^columns-(\d+|\[.+\])$/,
  /^break-(after|before|inside)-(auto|avoid|all|avoid-page|page|left|right|column)-?.*$/,
  /^box-(border|content)$/,
  /^touch-(auto|none|pan-x|pan-y|pinch-zoom|manipulation)$/,
  /^appearance-(none|auto)$/,
  /^decoration-.+$/,
  /^underline-offset-.+$/,
  /^indent-.+$/,
  /^tabular-nums$/,
];

function stripVariants(token) {
  let t = token.replace(/^!/, '');
  // Strip stacked variant prefixes (sm:, hover:, dark:, max-lg:, data-[...]:, …)
  while (true) {
    const idx = t.indexOf(':');
    if (idx === -1) break;
    t = t.slice(idx + 1);
  }
  return t;
}

function isUtility(token) {
  const base = stripVariants(token);
  if (!base || base.includes('${') || base.includes(' ') || base.includes('(')) return false;
  return UTILITY_PATTERNS.some((re) => re.test(base));
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (full.endsWith('.tsx')) yield full;
  }
}

function checkFile(absPath) {
  const rel = absPath.slice(root.length + 1);
  if (ALLOWED_DIRS.some((d) => rel === d || rel.startsWith(d + sep))) return null;
  const text = readFileSync(absPath, 'utf8');
  const hits = [];
  const attrRe = /className\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;
  let m;
  const record = (chunk, baseIndex) => {
    for (const token of chunk.split(/\s+/)) {
      if (isUtility(token)) {
        const line = text.slice(0, baseIndex).split('\n').length;
        hits.push({ line, token });
      }
    }
  };
  while ((m = attrRe.exec(text)) !== null) {
    const chunk = m[1] ?? m[2] ?? m[3] ?? '';
    record(chunk, m.index);
  }
  if (hits.length === 0) return null;
  return { file: rel.split(sep).join('/'), tokens: [...new Set(hits.map((h) => h.token))].sort(), lines: hits.length };
}

const results = {};
for (const f of walk(root)) {
  const r = checkFile(f);
  if (r) results[r.file] = { tokens: r.tokens, lines: r.lines };
}

const files = Object.keys(results).sort();
const totalLines = files.reduce((n, f) => n + results[f].lines, 0);

if (process.argv.includes('--update-baseline')) {
  const baseline = {};
  for (const f of files) baseline[f] = results[f].tokens;
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n');
  console.log(`Baseline updated: ${files.length} files, ${totalLines} utility hits.`);
  process.exit(0);
}

let baseline = {};
if (existsSync(baselinePath)) {
  baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
}

let failed = false;
for (const f of files) {
  const known = new Set(baseline[f] || []);
  const fresh = results[f].tokens.filter((t) => !known.has(t));
  if (fresh.length > 0) {
    failed = true;
    console.log(`NEW violations in ${f}: ${fresh.join(', ')}`);
  }
}
const fixed = Object.keys(baseline).filter((f) => !results[f]);
if (fixed.length > 0) {
  console.log(`Cleaned since baseline: ${fixed.join(', ')}`);
}

console.log(`\nScope: ${files.length} files outside ui|layout use Tailwind utilities (${totalLines} hits).`);
console.log('Rule: utilities live only in src/components/ui/** and src/components/layout/**.');
console.log('Pages compose Container / Stack / Flex / Grid / PageShell / Input / Button / Card / … via props.');

if (failed) {
  console.log('\nFAIL: new Tailwind utilities outside shared primitives. Move them into a shared component or update the baseline.');
  process.exit(1);
}
console.log('OK: no new violations vs baseline.');
