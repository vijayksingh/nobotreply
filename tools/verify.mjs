#!/usr/bin/env node
/**
 * Post-build verification. Checks every generated page for the things that are
 * easy to get silently wrong across 18 locales: language attributes, canonical
 * and hreflang wiring, unrendered markdown, broken internal links, invalid JS,
 * and the performance budget.
 *
 *   node tools/verify.mjs
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const SITE = 'https://nobotreply.com';

const ORDER = [
  'en', 'ar', 'zh', 'nl', 'fr', 'de', 'hi', 'id', 'it', 'ja',
  'ko', 'pl', 'pt-br', 'ru', 'es', 'tr', 'uk', 'vi',
];

const fail = [];
const warn = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : fail.push(msg));

const pagePath = (lang) => (lang === 'en' ? join(DIST, 'index.html') : join(DIST, lang, 'index.html'));

async function main() {
  if (!existsSync(DIST)) {
    console.error('no dist/ — run `node build.mjs` first');
    process.exit(1);
  }

  let totalGz = 0;

  for (const lang of ORDER) {
    const file = pagePath(lang);
    if (!existsSync(file)) {
      fail.push(`${lang}: page missing`);
      continue;
    }
    const html = await readFile(file, 'utf8');
    totalGz += gzipSync(html).length;

    // html element
    const htmlTag = html.match(/<html[^>]*>/)?.[0] ?? '';
    check(htmlTag.includes(`lang="${lang}"`), `${lang}: <html lang="${lang}">`);
    if (lang === 'ar') check(htmlTag.includes('dir="rtl"'), 'ar: <html dir="rtl">');
    else check(!htmlTag.includes('dir="rtl"'), `${lang}: no stray dir="rtl"`);

    // canonical
    const canonical = lang === 'en' ? `${SITE}/` : `${SITE}/${lang}/`;
    check(html.includes(`<link rel="canonical" href="${canonical}">`), `${lang}: canonical → ${canonical}`);

    // hreflang: one per language + x-default
    const alt = [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)];
    check(alt.length === ORDER.length + 1, `${lang}: hreflang count = ${alt.length} (want ${ORDER.length + 1})`);
    check(
      alt.some(([, h, u]) => h === 'x-default' && u === `${SITE}/`),
      `${lang}: x-default present`
    );
    const missingAlt = ORDER.filter((l) => !html.includes(`hreflang="${l === 'zh' ? 'zh-Hans' : l === 'pt-br' ? 'pt-BR' : l}"`));
    check(missingAlt.length === 0, `${lang}: hreflang covers all locales${missingAlt.length ? ` (missing ${missingAlt})` : ''}`);

    // language switcher lists every locale, current one marked
    const nav = html.match(/<nav class="lang-switcher"[\s\S]*?<\/nav>/)?.[0] ?? '';
    check((nav.match(/<a /g) ?? []).length === ORDER.length - 1, `${lang}: switcher has ${ORDER.length - 1} links`);
    check(nav.includes('aria-current="page"'), `${lang}: switcher marks current page`);

    // markdown must be fully rendered
    check(!html.includes('](http'), `${lang}: no unrendered [link](url)`);
    check(!/\*\*[^*]+\*\*/.test(html), `${lang}: no unrendered **bold**`);

    // required meta
    check(/<title>[^<]+<\/title>/.test(html), `${lang}: has <title>`);
    check(html.includes('property="og:image" content="' + SITE + '/og-image.png"'), `${lang}: og:image`);
    check(html.includes('name="twitter:card"'), `${lang}: twitter card`);
    check(html.includes('application/ld+json'), `${lang}: JSON-LD`);

    // inline scripts must parse
    const scripts = [...html.matchAll(/<script(?![^>]*type="application\/ld\+json")[^>]*>([\s\S]*?)<\/script>/g)];
    check(scripts.length === 2, `${lang}: 2 inline scripts`);
    for (const [i, s] of scripts.entries()) {
      try {
        new Function(s[1]);
      } catch (err) {
        fail.push(`${lang}: script #${i + 1} syntax error — ${err.message}`);
      }
    }

    // JSON-LD must parse
    const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
    try {
      JSON.parse(ld);
    } catch {
      fail.push(`${lang}: JSON-LD is not valid JSON`);
    }

    // every internal link resolves to a real file
    for (const [, href] of html.matchAll(/(?:href|src)="(\/[^"#]*)"/g)) {
      const target = href.endsWith('/') ? join(DIST, href, 'index.html') : join(DIST, href);
      if (!existsSync(target)) fail.push(`${lang}: broken internal link ${href}`);
    }

    // The performance promise in the README, enforced: a page load must be a
    // single request with no external subresource of any kind. Navigation links
    // (<a href="https://…">) are fine; anything the browser must *fetch* is not.
    const externals = [
      ...html.matchAll(/<(?:script|img|iframe|source|video|audio)\b[^>]*\bsrc="https?:\/\//g),
      ...html.matchAll(/<link\b[^>]*\brel="(?:stylesheet|preload|preconnect|dns-prefetch|prefetch)"/g),
      ...html.matchAll(/@font-face/g),
      ...html.matchAll(/url\(\s*['"]?https?:\/\//g),
    ];
    check(externals.length === 0, `${lang}: no external subresources (found ${externals.length})`);

    // byte budget
    const gz = gzipSync(html).length;
    check(gz < 12 * 1024, `${lang}: ${(gz / 1024).toFixed(1)} KB gzipped (< 12 KB)`);
  }

  // static files
  for (const f of ['favicon.svg', 'og-image.png', 'robots.txt', 'sitemap.xml', '_headers', '404.html', 'index.html']) {
    check(existsSync(join(DIST, f)), `dist/${f} exists`);
  }

  // sitemap
  const sitemap = await readFile(join(DIST, 'sitemap.xml'), 'utf8');
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  check(locs.length === ORDER.length, `sitemap lists ${locs.length} URLs`);
  for (const lang of ORDER) {
    const want = lang === 'en' ? `${SITE}/` : `${SITE}/${lang}/`;
    check(locs.includes(want), `sitemap includes ${want}`);
  }

  // no stray source files in dist
  const entries = await readdir(DIST);
  check(!entries.includes('style.css'), 'CSS is inlined (no render-blocking stylesheet)');
  check(!entries.some((e) => e.endsWith('.js')), 'no external JS bundles');

  // og image dimensions
  const og = await readFile(join(DIST, 'og-image.png'));
  const w = og.readUInt32BE(16);
  const h = og.readUInt32BE(20);
  check(w === 1200 && h === 630, `og-image.png is ${w}x${h} (want 1200x630)`);

  const pages = await Promise.all(ORDER.map((l) => stat(pagePath(l))));
  const totalRaw = pages.reduce((a, s) => a + s.size, 0);

  console.log(`\n  ${ok.length} checks passed`);
  if (warn.length) {
    console.log(`\n  warnings:`);
    for (const w of warn) console.log(`   ! ${w}`);
  }
  if (fail.length) {
    console.log(`\n  ${fail.length} FAILURES:`);
    for (const f of fail) console.log(`   ✕ ${f}`);
  }
  console.log(
    `\n  ${ORDER.length} pages · ${(totalGz / 1024).toFixed(1)} KB gzipped total · ` +
      `${(totalGz / ORDER.length / 1024).toFixed(1)} KB average per page · ` +
      `${(totalRaw / 1024).toFixed(0)} KB raw\n`
  );
  process.exit(fail.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
