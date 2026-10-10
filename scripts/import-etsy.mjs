#!/usr/bin/env node
/**
 * Import Etsy listings into src/content/products.
 *
 * Getting the CSV from Etsy:
 *   Shop Manager > Settings > Options > Download Data, then click "Download CSV"
 *   under "Currently for Sale Listings". Keep the file outside src/ (etsy-export/
 *   is gitignored).
 *
 * Usage:
 *   npm run import:etsy -- <EtsyListingsDownload.csv> [flags]
 *   node scripts/import-etsy.mjs <EtsyListingsDownload.csv> [flags]
 *
 *   --dry-run          Parse and print what would be imported. Writes nothing.
 *   --force            Overwrite product files that already exist (never originals).
 *   --replace-samples  After importing, delete the placeholder products (`sample: true`).
 *   --no-images        Do not download photos. Products get `images: []`.
 *
 *   npm run import:etsy -- --fetch-images
 *                      Download the Etsy photos recorded in each product's `etsyImages`
 *                      for products that have no `images` yet. No CSV needed. Use this
 *                      after an import with --no-images, once the network allows it.
 *
 * Each listing becomes src/content/products/<slug>.md and its photos are saved to
 * src/assets/products/<slug>/<n>.<ext>. Re-running is safe: existing files are
 * skipped unless --force, and paintings (category: originals) are never touched.
 * Read through every imported product afterwards, starting with the warnings
 * printed at the end.
 */

import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRODUCTS_DIR = path.join(ROOT, 'src/content/products');
const ASSETS_DIR = path.join(ROOT, 'src/assets/products');

const MAX_TAGS = 13;
const MAX_VARIANTS = 30;
const MAX_IMAGES = 10;
const CONCURRENCY = 4;
const TIMEOUT_MS = 30_000;
const RETRIES = 3;
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'];
const CONTENT_TYPES = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

const FLAGS = {
  '--dry-run': 'dryRun',
  '--force': 'force',
  '--replace-samples': 'replaceSamples',
  '--no-images': 'noImages',
  '--fetch-images': 'fetchImages',
};
const USAGE = `Usage: npm run import:etsy -- <EtsyListingsDownload.csv> [--dry-run] [--force] [--replace-samples] [--no-images]
       npm run import:etsy -- --fetch-images`;

/** Errors that end the run with a short message instead of a stack trace. */
class Fatal extends Error {}

/** Every warning is printed as it happens and again, grouped by slug, at the end. */
const warnings = [];
function warn(slug, message) {
  warnings.push({ slug, message });
  console.warn(`WARN ${slug}: ${message}`);
}

// CSV ---------------------------------------------------------------------

/**
 * RFC 4180 parser: quoted fields, "" escapes, commas and newlines inside quotes,
 * CRLF or LF line endings and a leading UTF-8 BOM. A quote in the middle of an
 * unquoted field is kept as a literal character. Blank lines are dropped.
 */
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let quoteStart = 0;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"' && field === '') {
      quoted = true;
      quoteStart = i;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (quoted) {
    const line = text.slice(0, quoteStart).split(/\r\n|\r|\n/).length;
    throw new Fatal(`CSV looks malformed: the quoted field starting on line ${line} never closes`);
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

/** Header names compared without case, spaces or underscores ("Currency code" = "CURRENCY_CODE"). */
const headerKey = (h) => h.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Returns get(row, name), which reads a column by name and gives '' when it is missing. */
function columnReader(header) {
  const index = new Map();
  header.forEach((h, i) => index.has(headerKey(h)) || index.set(headerKey(h), i));
  return (row, name) => {
    const i = index.get(headerKey(name));
    return i === undefined ? '' : (row[i] ?? '').trim();
  };
}

// Text helpers ------------------------------------------------------------

const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };

/** Etsy exports titles and descriptions with HTML entities such as &#39; and &quot;. */
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, e) => {
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? match;
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

/** Decoded text without control characters (tabs and newlines are kept). */
const clean = (s) => decodeEntities(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');

const ascii = (s) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
const kebab = (s) =>
  ascii(s)
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Comma separated list, trimmed, without blanks or case-insensitive duplicates. */
function splitList(raw) {
  const seen = new Set();
  return clean(raw)
    .split(',')
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter((s) => {
      const key = s.toLowerCase();
      if (!s || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Product fields ----------------------------------------------------------

/**
 * Etsy titles are keyword lists ("Gold Hoops, Minimalist Earrings | Gift for Her").
 * Keep the first phrase: everything before the first comma, pipe or spaced dash.
 */
function shortTitle(full) {
  const first = full.split(/,|\||\s[-\u2013\u2014]\s/)[0].trim();
  return (first || full).replace(/\s+/g, ' ').replace(/[\s.;:]+$/, '');
}

const SMALL_WORDS = new Set(['a', 'an', 'and', 'the', 'of', 'for', 'with', 'in', 'on', 'or', 'to', 'by', 'at', 'from']);

/** "MYSTIC MOTHER NECKLACE" reads as shouting on the site; give all-caps titles title case. */
function tidyCase(title) {
  if (title !== title.toUpperCase() || !/[A-Z]/.test(title)) return title;
  return title
    .toLowerCase()
    .split(' ')
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.replace(/^(\p{L})/u, (c) => c.toUpperCase())))
    .join(' ');
}

const STOP_WORDS = new Set(['a', 'an', 'and', 'the', 'of', 'for', 'with', 'in', 'on', 'or', 'to', 'by', 'at', 'from']);

/** Up to six meaningful words and 60 characters, ASCII only, cut on a word boundary. */
function slugify(title) {
  const kept = [];
  let meaningful = 0;
  for (const word of kebab(title).split('-').filter(Boolean)) {
    if (meaningful === 6) break;
    kept.push(word);
    if (!STOP_WORDS.has(word)) meaningful++;
  }
  while (kept.length > 1 && kept.join('-').length > 60) kept.pop();
  while (kept.length > 1 && STOP_WORDS.has(kept.at(-1))) kept.pop();
  return kept.join('-').slice(0, 60).replace(/-+$/, '');
}

/** First of base, base-2, base-3 ... not in `taken` or `avoid`. Adds the result to `taken`. */
function uniqueSlug(base, taken, avoid = new Set()) {
  let slug = base;
  for (let n = 2; taken.has(slug) || avoid.has(slug); n++) slug = `${base}-${n}`;
  taken.add(slug);
  return slug;
}

/**
 * Category keywords, checked in this order and matched as whole words (plurals
 * too), so "earrings" never counts as "ring". Strong words name the product
 * type; hints only describe it, so "Long Drop Necklace" is a necklace, not an
 * earring. The title is checked first, then tags, then materials.
 */
const CATEGORY_RULES = [
  { category: 'earrings', strong: ['earring', 'ear cuff', 'ear climber', 'threader'], hints: ['stud', 'hoop', 'huggie', 'drop', 'dangle'] },
  { category: 'necklaces', strong: ['necklace', 'pendant', 'choker'], hints: ['chain'] },
  { category: 'rings', strong: ['ring'], hints: ['band', 'signet'] },
  { category: 'bracelets', strong: ['bracelet', 'bangle', 'anklet'], hints: ['cuff'] },
  { category: 'cards', strong: ['card set', 'greeting card', 'notecard', 'note card'], hints: ['card', 'stationery'] },
  { category: 'prints', strong: ['print', 'giclee', 'poster'], hints: [] },
  { category: 'originals', strong: ['painting'], hints: ['original', 'canvas', 'oil'] },
];
const wordRegex = (word) => new RegExp(`\\b${word.replace(/ /g, '[\\s-]?')}(?:s|es)?\\b`);
const TIERS = ['strong', 'hints'].map((tier) =>
  CATEGORY_RULES.map((rule) => ({ category: rule.category, patterns: rule[tier].map(wordRegex) })),
);

/** Returns a category, or undefined when no keyword matched. */
function inferCategory(sources) {
  for (const source of sources) {
    const text = ascii(source).toLowerCase();
    for (const tier of TIERS) {
      const hit = tier.find((rule) => rule.patterns.some((re) => re.test(text)));
      if (hit) return hit.category;
    }
  }
  return undefined;
}

function parsePrice(raw) {
  const n = Number(raw.replace(/[^0-9.]/g, ''));
  return raw && /\d/.test(raw) && Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
}

/** One variant per value, or every combination ("Gold / Size 7") when there are two variations. */
function buildVariants(get, row, slug) {
  const dimensions = [1, 2].map((n) => splitList(get(row, `VARIATION ${n} VALUES`))).filter((values) => values.length);
  if (!dimensions.length) return [];
  const combos = dimensions.reduce((acc, values) => acc.flatMap((parts) => values.map((v) => [...parts, v])), [[]]);
  if (combos.length > MAX_VARIANTS) warn(slug, `${combos.length} variant combinations, kept the first ${MAX_VARIANTS}`);
  const ids = new Set();
  return combos.slice(0, MAX_VARIANTS).map((parts, i) => {
    const label = parts.join(' / ');
    return { id: uniqueSlug(kebab(label) || `option-${i + 1}`, ids), label };
  });
}

/** Lines about shop policy that belong on the policy pages, not in a product description. */
const BOILERPLATE = /shop polic(?:y|ies)|processing time|feel free to (?:message|contact|convo)|convo me|\betsy\b/i;
/** Decorative rules like ----- or ***** or ~~~~~ (Markdown would read them as headings or code fences). */
const SEPARATOR = /^[-=_~*#.+\u2022\u00b7\s]{3,}$/;

/** Description as paragraphs of lines, with boilerplate and decorative rules removed. */
function descriptionParagraphs(raw) {
  const paragraphs = [];
  let current = [];
  const flush = () => {
    if (current.length) paragraphs.push(current);
    current = [];
  };
  for (const rawLine of clean(raw).replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line || SEPARATOR.test(line)) flush();
    else if (!BOILERPLATE.test(line)) current.push(line);
  }
  flush();
  return paragraphs;
}

/** Keep Etsy's plain text from turning into HTML, headings or block quotes. */
const markdownLine = (line) => line.replace(/</g, '&lt;').replace(/^(#{1,6}\s|>)/, '\\$1');

/** Blank lines separate paragraphs; single newlines become Markdown line breaks. */
const toMarkdown = (paragraphs) => paragraphs.map((lines) => lines.map(markdownLine).join('  \n')).join('\n\n');

/**
 * The studio's listings follow a pattern: the title again, an intention line
 * ("TRANQUILITY · PROTECTION · CLARITY"), the story, a "Details" block of
 * "Label: value" lines, a care list, then a shop sign-off. Pull the structured
 * parts out and drop the repeated title and the sign-off.
 */
const INTENTION = /^[\p{Lu}][\p{Lu}'\s]+(\s*[\u00b7\u2022|]\s*[\p{Lu}][\p{Lu}'\s]+){1,4}$/u;
const SIGN_OFF = /^(\p{Extended_Pictographic}|instagram:|portfolio|follow for|shop meaningful)|art & power|simone chagoya studio$/iu;
const COPYRIGHT = /^(\u00a9|\(c\))|all rights reserved/i;

/** One spec value: no trailing period, single spaces, and "15 mm \u2014 30 mm" ranges read "15 mm to 30 mm". */
const tidySpec = (v) =>
  v
    .trim()
    .replace(/\.$/, '')
    .replace(/\s+/g, ' ')
    .replace(/(\d\s*(?:mm|cm|in)?)\s*[\u2013\u2014]\s*(?=\d)/g, '$1 to ');

function structuredDescription(raw, shortName) {
  const lines = clean(raw).replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim());
  const out = { intention: undefined, specs: [], care: [], kept: [] };
  let section = 'body';
  const titleStart = ascii(shortName).toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Check the copyright line first: \u00a9 counts as a pictograph to SIGN_OFF.
    if (COPYRIGHT.test(line)) continue;
    if (SIGN_OFF.test(line)) break;
    if (i < 2 && line && ascii(line).toLowerCase().startsWith(titleStart)) continue;
    if (!out.intention && INTENTION.test(line) && line.split(/\s+/).length <= 8) {
      out.intention = tidyCase(line.replace(/\s*[\u00b7\u2022|]\s*/g, ' \u00b7 '));
      continue;
    }
    if (/^details:?$/i.test(line)) {
      section = 'details';
      continue;
    }
    if (/^(jewelry |jewellery )?care:?$/i.test(line)) {
      section = 'care';
      continue;
    }
    if (!line || SEPARATOR.test(line)) {
      section = 'body';
      out.kept.push('');
      continue;
    }
    if (section === 'details') {
      const m = line.match(/^([^:]{2,40}):\s*(.+)$/) ?? line.match(/^(Clasp)\s+(.+)$/i);
      if (m) out.specs.push({ label: capitalize(m[1].trim()), value: tidySpec(m[2]) });
      else if (/hand strung/i.test(line)) out.specs.push({ label: 'Stringing', value: capitalize(tidySpec(line.replace(/^.*?(hand strung)/i, '$1'))) });
      else if (/silver|gold|clasp/i.test(line)) out.specs.push({ label: 'Metal', value: tidySpec(line) });
      else out.specs.push({ label: 'Detail', value: tidySpec(line) });
      continue;
    }
    if (section === 'care') {
      out.care.push(line);
      continue;
    }
    out.kept.push(line);
  }
  return out;
}

/** Paragraphs from kept lines; a lead line ending in ":" becomes a bold label. */
function keptParagraphs(kept) {
  const paragraphs = [];
  let current = [];
  for (const line of [...kept, '']) {
    if (line) {
      if (!BOILERPLATE.test(line)) current.push(line);
    } else if (current.length) {
      paragraphs.push(current);
      current = [];
    }
  }
  return paragraphs.map((lines) => (/:$/.test(lines[0]) && lines.length > 1 ? [`**${lines[0].slice(0, -1)}**`, ...lines.slice(1)] : lines));
}

const specValue = (specs, re) => specs.find((s) => re.test(s.label))?.value;

/**
 * Stone colors for the stand-in illustration a product shows until its photos
 * arrive. Matched against the gemstone line, then the title and materials.
 */
const STONES = [
  { re: /smoky|smoke/i, colors: ['#8a7868', '#b8aa9a', '#e9ecec', '#6e5f52', '#d9d2c8'], clear: true, ground: '#e8e3dc' },
  { re: /aquamarine/i, colors: ['#a9d4dc', '#8cc3cf', '#c6e3e8', '#7fb6c4'], clear: true, ground: '#e2e7e6' },
  { re: /crackle|clear quartz|rock crystal/i, colors: ['#eef3f4', '#e3eaec', '#f6f8f8'], clear: true, ground: '#e5e3de' },
  { re: /amethyst/i, colors: ['#7b4fa0', '#9065b5', '#5e3a86', '#a77fc6', '#6a4593'], ground: '#e9e4e6' },
  { re: /fluorite/i, colors: ['#7fb59a', '#5c3f80', '#a9d1c0', '#d9e6e3', '#6aa18f', '#9b7fc0'], ground: '#e4e5df' },
  { re: /goldstone/i, colors: ['#b5651d', '#c97a2b', '#8f4a14', '#d68b3c'], ground: '#ece4d8' },
  { re: /tiger/i, colors: ['#a8742f', '#7a4f1e', '#c48f45', '#5e3a17', '#d4a35a'], ground: '#ebe3d6' },
  { re: /apatite/i, colors: ['#2f8fa6', '#4fb0c4', '#d9823b', '#1f6f86', '#e7a35a'], ground: '#e3e6e4' },
  { re: /mother of pearl|pearl/i, colors: ['#fbf8f2'], beads: 'flower', ground: '#ebe3d9' },
  { re: /opal/i, colors: ['#5f6b5d', '#7d8676', '#46514a', '#9aa08f', '#b5b09f'], ground: '#e3e2d9' },
  { re: /agate|lapis/i, colors: ['#0f5a73', '#167089', '#0c4a60', '#1f7f95'], ground: '#e2e4e0' },
  { re: /jade/i, colors: ['#2f4a35', '#3d5c40', '#1f3326', '#4a6b4a'], ground: '#e5e3db' },
  { re: /turquoise/i, colors: ['#1f8a86', '#2ba39b', '#5fbdb2', '#176e6b'], ground: '#e3e6e3' },
  { re: /coral|carnelian/i, colors: ['#f07a5a', '#f28a6a', '#e86c4e'], ground: '#ece4dc' },
  { re: /citrine|honey|amber/i, colors: ['#c98a3c', '#b8742c', '#d9a65a', '#e0b674'], ground: '#ece5d9' },
  { re: /rose quartz/i, colors: ['#f2c9cc', '#eab7bc', '#f7dadd'], ground: '#ece4e2' },
  { re: /onyx|obsidian|black/i, colors: ['#1c1b1d', '#2a292c', '#121113'], ground: '#e6e2db' },
];

function inferArt(p, specs, text) {
  if (p.category === 'prints' || p.category === 'cards') {
    const night = /star|night|galaxy|cosmos|sky/i.test(text);
    const leaves = /jungle|leaf|leaves|plant|monstera/i.test(text);
    return {
      kind: p.category === 'cards' ? 'cards' : 'print',
      ground: '#e6e1d8',
      pattern: night ? 'speckle' : leaves ? 'leaves' : 'wash',
      colors: night
        ? ['#ffffff', '#f3e7a6', '#a9d18e', '#cfe3f2']
        : leaves
          ? ['#2f7d4a', '#4fae5c', '#1f5f3c', '#7cc46a', '#38966b']
          : ['#e2554f', '#f39a3c', '#5aa64a', '#2bb3b1', '#9b7fd1', '#24345c'],
    };
  }
  if (!['necklaces', 'bracelets'].includes(p.category)) return undefined;
  const gem = specValue(specs, /gem|stone/i) ?? '';
  const stone = STONES.find((s) => s.re.test(gem)) ?? STONES.find((s) => s.re.test(`${p.title} ${p.materials.join(' ')}`));
  const metalText = `${specValue(specs, /clasp|metal|component/i) ?? ''} ${text}`;
  const metal = /\bgold/i.test(specValue(specs, /clasp|metal|component/i) ?? '') ? 'gold' : /sterling|silver/i.test(metalText) ? 'silver' : 'gold';
  const shape = `${specValue(specs, /shape/i) ?? ''} ${specValue(specs, /size/i) ?? ''}`;
  const sizes = (specValue(specs, /bead size/i) ?? '').match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const length = parseFloat(specValue(specs, /length/i) ?? '') || 16;
  const along = sizes.length ? (/oval|faceted|multi/i.test(shape) ? Math.max(...sizes) : /x/i.test(shape) ? Math.min(...sizes) : sizes[0]) : 10;
  const average = /multi/i.test(shape) && sizes.length > 1 ? (sizes[0] + sizes.at(-1)) / 2 : along;
  const count = Math.round(Math.min(80, Math.max(14, (length * 25.4) / average)));
  const beads = stone?.beads ?? (/oval|faceted multi/i.test(shape) ? 'oval' : /cube|tube|x/i.test(shape) && sizes.length > 1 ? 'tube' : 'round');
  return {
    kind: 'necklace',
    ground: stone?.ground ?? '#e7e2da',
    metal,
    beads,
    count,
    clear: Boolean(stone?.clear),
    colors: stone?.colors ?? ['#b9b1a5', '#8d8478', '#d8d0c4'],
  };
}

/** First sentence of the description when it reads like one: capitalized, 4+ words, ends in . ! or ? */
function firstSentence(paragraphs) {
  const first = paragraphs[0]?.[0] ?? '';
  const sentence = first.match(/^(.+?[.!?])(?=\s|$)/)?.[1].trim();
  if (!sentence || sentence.length > 140) return undefined;
  if (sentence.split(/\s+/).length < 4 || !/^["'(\u201c]?[\p{Lu}\d]/u.test(sentence)) return undefined;
  if ((sentence.match(/,/g) ?? []).length > 2) return undefined; // a keyword list, not a sentence
  return sentence;
}

/** Turns one CSV row into a product, or returns undefined for rows without a title. */
function buildProduct(get, row, index, taken, originals) {
  const fullTitle = clean(get(row, 'TITLE')).replace(/\s+/g, ' ').trim();
  if (!fullTitle) {
    warn(`row ${index + 2}`, 'no TITLE, skipped');
    return undefined;
  }
  const title = tidyCase(shortTitle(fullTitle));
  const tags = splitList(get(row, 'TAGS')).map((t) => t.toLowerCase()).slice(0, MAX_TAGS);
  const materials = splitList(get(row, 'MATERIALS')).map(capitalize);
  const inferred = inferCategory([fullTitle, tags.join(', '), materials.join(', ')]);
  const category = inferred ?? 'necklaces';

  // Jewelry or a print named after a painting gets a suffix so it never lands on the
  // painting's file. A listing that is itself a painting keeps its slug, and main()
  // skips it if that slug is already an original. Either way re-runs give the same slug.
  const base = slugify(title) || `listing-${index + 1}`;
  const slug = uniqueSlug(base, taken, category === 'originals' ? undefined : originals);
  if (slug !== base && originals.has(base) && category !== 'originals') {
    warn(slug, `"${base}" is an original painting on the site, so this listing was imported as "${slug}"`);
  }
  if (!inferred) warn(slug, 'no category keyword matched, defaulted to necklaces. Set the category by hand.');

  let price = parsePrice(get(row, 'PRICE'));
  if (price === undefined) {
    warn(slug, `PRICE "${get(row, 'PRICE')}" is not a number, set to 0`);
    price = 0;
  }
  const currency = get(row, 'CURRENCY_CODE').toUpperCase();
  if (currency && currency !== 'USD') warn(slug, `price is in ${currency}, the site sells in USD`);

  const quantity = parseInt(get(row, 'QUANTITY'), 10);
  const stock = Number.isFinite(quantity) ? Math.max(0, quantity) : 1;
  const description = get(row, 'DESCRIPTION');
  const parsed = structuredDescription(description, shortTitle(fullTitle));
  const paragraphs = keptParagraphs(parsed.kept);
  const imageUrls = Array.from({ length: MAX_IMAGES }, (_, i) => get(row, `IMAGE${i + 1}`)).filter(Boolean);

  // Lead with the gemstone and the clasp from the Details block when there is one.
  const gem = specValue(parsed.specs, /gem|stone/i);
  const clasp = specValue(parsed.specs, /clasp|metal|component/i);
  const detailed = [gem, clasp].filter(Boolean);
  // Compare with curly apostrophes folded, so "Tiger's eye" from the materials column matches "Tiger\u2019s Eye" from the description.
  const fold = (t) => t.toLowerCase().replace(/[\u2018\u2019]/g, "'");
  const allMaterials = detailed.length ? [...new Set([...detailed, ...materials.filter((m) => !/^gemstone$/i.test(m) && !detailed.some((d) => fold(d).includes(fold(m))))])] : materials;
  const dimensions =
    specValue(parsed.specs, /length/i) ?? fullTitle.match(/\d+(?:\.\d+)?\s*x\s*\d+(?:\.\d+)?\s*in\.?/i)?.[0];
  const storyStart = paragraphs.findIndex((lines) => /\bis for\b/i.test(lines[0]));
  const summary = firstSentence(storyStart > -1 ? paragraphs.slice(storyStart) : paragraphs);
  const draft = { title, category, materials: allMaterials };

  return {
    slug,
    title,
    category,
    price,
    summary,
    intention: parsed.intention,
    specs: parsed.specs,
    care: parsed.care,
    dimensions,
    art: inferArt(draft, parsed.specs, `${fullTitle} ${description}`),
    materials: allMaterials,
    variants: buildVariants(get, row, slug),
    stock,
    oneOfAKind: stock === 1,
    // Originals are sold by conversation on this site, not through the cart.
    status: stock <= 0 ? 'sold' : category === 'originals' ? 'inquire' : 'available',
    tags,
    order: (index + 1) * 10,
    etsyId: get(row, 'SKU') || undefined,
    body: toMarkdown(paragraphs),
    imageUrls,
    images: [],
  };
}

// Files -------------------------------------------------------------------

/** Reads the flags we care about from an existing product's frontmatter, or null if there is no file. */
async function readProductFlags(file) {
  const text = await readFile(file, 'utf8').catch(() => null);
  if (text === null) return null;
  const fm = text.match(/^\ufeff?---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
  return {
    original: /^category:\s*["']?originals["']?\s*(#.*)?$/m.test(fm),
    sample: /^sample:\s*true\s*(#.*)?$/m.test(fm),
    featured: /^featured:\s*true\s*(#.*)?$/m.test(fm),
  };
}

/** Map of slug to frontmatter flags for every product file on disk. */
async function scanProducts() {
  const files = await readdir(PRODUCTS_DIR).catch(() => []);
  const entries = await Promise.all(
    files
      .filter((f) => f.endsWith('.md'))
      .map(async (f) => [f.slice(0, -3), await readProductFlags(path.join(PRODUCTS_DIR, f))]),
  );
  return new Map(entries);
}

/** JSON strings are valid YAML double-quoted strings, so every string goes through this. */
const q = (s) => JSON.stringify(s);

function toFile(p) {
  const lines = [`title: ${q(p.title)}`, `category: ${p.category}`, `price: ${p.price}`];
  if (p.summary) lines.push(`summary: ${q(p.summary)}`);
  if (p.intention) lines.push(`intention: ${q(p.intention)}`);
  lines.push(p.images.length ? 'images:' : 'images: []', ...p.images.map((img) => `  - ${q(img)}`));
  lines.push(`etsyImages: ${JSON.stringify(p.imageUrls)}`);
  if (p.art) lines.push(`art: ${JSON.stringify(p.art)}`);
  lines.push(`materials: [${p.materials.map(q).join(', ')}]`);
  if (p.dimensions) lines.push(`dimensions: ${q(p.dimensions)}`);
  if (p.specs?.length) lines.push('specs:', ...p.specs.map((s) => `  - { label: ${q(s.label)}, value: ${q(s.value)} }`));
  if (p.care?.length) lines.push('care:', ...p.care.map((c) => `  - ${q(c)}`));
  if (p.variants.length) lines.push('variants:', ...p.variants.map((v) => `  - { id: ${q(v.id)}, label: ${q(v.label)} }`));
  lines.push(`stock: ${p.stock}`, `oneOfAKind: ${p.oneOfAKind}`, `status: ${p.status}`);
  if (p.featured) lines.push('featured: true');
  lines.push(`tags: [${p.tags.map(q).join(', ')}]`, `order: ${p.order}`);
  if (p.etsyId) lines.push(`etsyId: ${q(p.etsyId)}`);
  return `---\n${lines.join('\n')}\n---\n${p.body ? `\n${p.body}\n` : ''}`;
}

// Images ------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function extFromUrl(url) {
  const ext = path.extname(new URL(url).pathname).slice(1).toLowerCase();
  return IMAGE_EXTS.includes(ext) ? ext : undefined;
}

const describeError = (err) =>
  err?.name === 'TimeoutError' ? `timed out after ${TIMEOUT_MS / 1000}s` : (err?.cause?.code ?? err?.message ?? String(err));

/** GET an image with a timeout. Network errors, timeouts, 429 and 5xx are retried with backoff. */
async function fetchImage(url) {
  let lastError;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt) await sleep(1000 * 2 ** (attempt - 1));
    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      lastError = new Error(describeError(err));
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      lastError = new Error(`HTTP ${res.status}`);
      if (res.status === 408 || res.status === 429 || res.status >= 500) continue;
      break; // other 4xx will not get better on retry
    }
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (type && !type.startsWith('image/') && type !== 'application/octet-stream') {
      await res.body?.cancel().catch(() => {});
      lastError = new Error(`not an image (${type})`);
      break;
    }
    try {
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length) return { bytes, ext: CONTENT_TYPES[type] ?? extFromUrl(url) ?? 'jpg' };
      lastError = new Error('empty response');
    } catch (err) {
      lastError = new Error(describeError(err));
    }
  }
  throw lastError;
}

/** A previously downloaded, non-empty <n>.<ext> for this slot, if any. */
async function existingImage(dir, n) {
  for (const ext of IMAGE_EXTS) {
    const file = path.join(dir, `${n}.${ext}`);
    if ((await stat(file).catch(() => null))?.size > 0) return file;
  }
  return undefined;
}

/**
 * Downloads every product's photos, at most CONCURRENCY at a time, and fills in
 * product.images with the ones that made it. Files keep their Etsy position
 * (IMAGE3 is always 3.jpg), so a re-run finds and skips them.
 */
async function downloadImages(products, counts) {
  const jobs = products.flatMap((p) => p.imageUrls.map((url, i) => ({ p, url, n: i + 1 })));
  const found = new Map(products.map((p) => [p, []]));
  let next = 0;

  async function worker() {
    while (next < jobs.length) {
      const { p, url, n } = jobs[next++];
      const dir = path.join(ASSETS_DIR, p.slug);
      try {
        let file = await existingImage(dir, n);
        if (file) counts.reused++;
        else {
          if (!/^https?:$/.test(new URL(url).protocol)) throw new Error('not an http(s) URL');
          const { bytes, ext } = await fetchImage(url);
          file = path.join(dir, `${n}.${ext}`);
          await mkdir(dir, { recursive: true });
          await writeFile(`${file}.part`, bytes);
          await rename(`${file}.part`, file);
          counts.downloaded++;
          console.log(`  image  ${p.slug}/${path.basename(file)}`);
        }
        found.get(p).push({ n, file });
      } catch (err) {
        counts.failed++;
        warn(p.slug, `image ${n} failed (${err.message}): ${url}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  for (const [p, files] of found) {
    p.images = files
      .sort((a, b) => a.n - b.n)
      .map(({ file }) => path.relative(PRODUCTS_DIR, file).split(path.sep).join('/'));
  }
}

// Output ------------------------------------------------------------------

function printTable(rows, headers) {
  const widths = headers.map((h) => Math.max(h.length, ...rows.map((r) => String(r[h]).length)));
  const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join('  ').trimEnd();
  console.log(line(headers));
  console.log(line(widths.map((w) => '-'.repeat(w))));
  for (const r of rows) console.log(line(headers.map((h) => r[h])));
}

function printSummary(lines) {
  console.log('\nSummary');
  for (const [label, value] of lines) console.log(`  ${`${label}:`.padEnd(20)} ${value}`);
  if (!warnings.length) return;
  console.log('\nCheck these by hand:');
  const bySlug = Map.groupBy(warnings, (w) => w.slug);
  for (const [slug, list] of bySlug) {
    console.log(`  ${slug}`);
    for (const w of list) console.log(`    - ${w.message}`);
  }
}

// Main --------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { csv: undefined, dryRun: false, force: false, replaceSamples: false, noImages: false, fetchImages: false };
  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') {
      console.log(USAGE);
      process.exit(0);
    } else if (FLAGS[arg]) opts[FLAGS[arg]] = true;
    else if (arg.startsWith('-')) throw new Fatal(`unknown flag ${arg}`);
    else if (!opts.csv) opts.csv = arg;
    else throw new Fatal(`unexpected argument ${arg}`);
  }
  if (!opts.csv && !opts.fetchImages) throw new Fatal('missing the path to the Etsy listings CSV');
  return opts;
}

/**
 * Downloads photos for products imported earlier without them: every product file
 * with an `etsyImages` list and `images: []` gets its photos and an `images` list.
 */
async function fetchMissingImages() {
  const files = (await readdir(PRODUCTS_DIR)).filter((f) => f.endsWith('.md'));
  const pending = [];
  for (const f of files) {
    const file = path.join(PRODUCTS_DIR, f);
    const text = await readFile(file, 'utf8');
    const urls = text.match(/^etsyImages:\s*(\[.*\])\s*$/m)?.[1];
    if (!urls || !/^images:\s*\[\]\s*$/m.test(text)) continue;
    const imageUrls = JSON.parse(urls);
    if (imageUrls.length) pending.push({ slug: f.slice(0, -3), file, text, imageUrls, images: [] });
  }
  if (!pending.length) {
    console.log('Every product with Etsy photos already has images. Nothing to do.');
    return;
  }
  console.log(`Downloading photos for ${pending.length} product${pending.length === 1 ? '' : 's'}...`);
  const counts = { downloaded: 0, reused: 0, failed: 0 };
  await downloadImages(pending, counts);
  let updated = 0;
  for (const p of pending) {
    if (!p.images.length) continue;
    const list = ['images:', ...p.images.map((img) => `  - ${q(img)}`)].join('\n');
    await writeFile(p.file, p.text.replace(/^images:\s*\[\]\s*$/m, list));
    updated++;
  }
  printSummary([
    ['products updated', updated],
    ['images downloaded', `${counts.downloaded} (${counts.reused} already present, ${counts.failed} failed)`],
    ['warnings', warnings.length],
  ]);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.fetchImages) return fetchMissingImages();
  // npm runs scripts from the project root; INIT_CWD is where the command was typed.
  const csvPath = path.resolve(process.env.INIT_CWD ?? process.cwd(), opts.csv);
  const text = await readFile(csvPath, 'utf8').catch((err) => {
    throw new Fatal(err.code === 'ENOENT' ? `CSV not found: ${csvPath}` : `could not read ${csvPath}: ${err.message}`);
  });

  const [header, ...rows] = parseCsv(text);
  if (!header) throw new Fatal(`no header row in ${csvPath}`);
  if (!header.some((h) => headerKey(h) === 'TITLE')) {
    throw new Fatal(`no TITLE column in the header row. Is this the Etsy listings CSV? Found: ${header.join(', ')}`);
  }
  const get = columnReader(header);
  const shown = path.relative(process.cwd(), csvPath);
  console.log(`Read ${rows.length} listing${rows.length === 1 ? '' : 's'} from ${shown.startsWith('..') ? csvPath : shown}\n`);

  const onDisk = await scanProducts();
  const originals = new Set([...onDisk].filter(([, flags]) => flags?.original).map(([slug]) => slug));
  const taken = new Set();
  const products = rows.map((row, i) => buildProduct(get, row, i, taken, originals)).filter(Boolean);

  // Originals are never written, whatever the flags. Samples count as replaceable with --replace-samples.
  for (const p of products) {
    const existing = onDisk.get(p.slug);
    p.featured = Boolean(existing?.featured); // curation survives --force
    p.action = !existing
      ? 'create'
      : existing.original
        ? 'skip (original)'
        : opts.force
          ? 'overwrite'
          : opts.replaceSamples && existing.sample
            ? 'overwrite (sample)'
            : 'skip (exists)';
    if (p.action === 'skip (original)') warn(p.slug, 'an original painting with this slug is already on the site and was left alone');
    else if (p.category === 'originals') warn(p.slug, 'imported as an original painting with status: inquire. Add year, medium and dimensions by hand.');
  }
  const toWrite = products.filter((p) => !p.action.startsWith('skip'));
  const skipped = (reason) => products.filter((p) => p.action === `skip (${reason})`).length;

  if (opts.dryRun) {
    console.log('');
    printTable(
      products.map((p) => ({
        slug: p.slug,
        category: p.category,
        price: p.price,
        stock: p.stock,
        variants: p.variants.length,
        images: opts.noImages ? 0 : p.imageUrls.length,
        action: p.action,
      })),
      ['slug', 'category', 'price', 'stock', 'variants', 'images', 'action'],
    );
    const replaced = new Set(toWrite.map((p) => p.slug));
    const samples = [...onDisk].filter(([slug, f]) => f?.sample && !f.original && !replaced.has(slug)).map(([s]) => s);
    if (opts.replaceSamples && products.length) console.log(`\nWould remove ${samples.length} sample products: ${samples.join(', ')}`);
    printSummary([
      ['listings', products.length],
      ['would create', products.filter((p) => p.action === 'create').length],
      ['would overwrite', products.filter((p) => p.action.startsWith('overwrite')).length],
      ['would skip', `${skipped('exists')} (exists), ${skipped('original')} (original)`],
      ['warnings', warnings.length],
    ]);
    console.log('\nDry run: nothing was written.');
    return;
  }

  const counts = { created: 0, updated: 0, downloaded: 0, reused: 0, failed: 0 };
  if (!opts.noImages && toWrite.length) {
    console.log('Downloading photos...');
    await downloadImages(toWrite, counts);
  }

  await mkdir(PRODUCTS_DIR, { recursive: true });
  for (const p of products) {
    const file = path.join(PRODUCTS_DIR, `${p.slug}.md`);
    const rel = path.relative(ROOT, file);
    if (p.action === 'skip (exists)') console.log(`  skip   ${rel} (exists, use --force to overwrite)`);
    if (p.action.startsWith('skip')) continue;
    // Check again right before writing: originals are never overwritten, whatever the flags.
    const current = await readProductFlags(file);
    if (current?.original) {
      warn(p.slug, `${rel} is an original painting and was left alone`);
      continue;
    }
    await writeFile(file, toFile(p));
    counts[current ? 'updated' : 'created']++;
    console.log(`  ${current ? 'update' : 'create'} ${rel}`);
  }

  // Every listing is now on the site (written, or already there), so the samples can go.
  const removed = [];
  if (opts.replaceSamples && products.length > 0) {
    for (const [slug, flags] of await scanProducts()) {
      if (!flags?.sample || flags.original) continue;
      await unlink(path.join(PRODUCTS_DIR, `${slug}.md`));
      removed.push(slug);
      console.log(`  remove src/content/products/${slug}.md (sample)`);
    }
  } else if (opts.replaceSamples) {
    console.log('Nothing was imported, so the sample products were kept.');
  }

  printSummary([
    ['listings', products.length],
    ['created', counts.created],
    ['updated', counts.updated],
    ['skipped (exists)', skipped('exists')],
    ...(skipped('original') ? [['skipped (original)', skipped('original')]] : []),
    ['images downloaded', `${counts.downloaded} (${counts.reused} already present, ${counts.failed} failed)`],
    ...(opts.replaceSamples ? [['samples removed', removed.length ? `${removed.length}: ${removed.join(', ')}` : 0]] : []),
    ['warnings', warnings.length],
  ]);
}

main().catch((err) => {
  if (err instanceof Fatal) {
    console.error(`ERROR: ${err.message}\n${USAGE}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
