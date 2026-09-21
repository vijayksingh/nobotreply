#!/usr/bin/env node
/**
 * no bot reply — static site generator.
 *
 * Zero dependencies. Reads content/<lang>.json, writes a fully self-contained
 * HTML file per language into dist/. CSS is inlined, avatars are inline SVG data
 * URIs, there are no web fonts and no client-side framework: every page is a
 * single request with no render-blocking subresources.
 *
 *   node build.mjs
 */
import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = join(ROOT, 'content');
const DIST = join(ROOT, 'dist');

const SITE = 'https://nobotreply.com';

const AUTHOR = {
  name: 'Vijay Singh',
  github: 'https://github.com/vijayksingh',
  linkedin: 'https://www.linkedin.com/in/iamvijaysingh/',
  x: 'https://twitter.com/dprophecyguy',
};

/** Display order for the footer switcher: English first, then alphabetical by English name. */
const ORDER = [
  'en', 'ar', 'zh', 'nl', 'fr', 'de', 'hi', 'id', 'it', 'ja',
  'ko', 'pl', 'pt-br', 'ru', 'es', 'tr', 'uk', 'vi',
];

/** og:locale values. */
const OG_LOCALE = {
  en: 'en_US', ar: 'ar_AR', zh: 'zh_CN', nl: 'nl_NL', fr: 'fr_FR', de: 'de_DE',
  hi: 'hi_IN', id: 'id_ID', it: 'it_IT', ja: 'ja_JP', ko: 'ko_KR', pl: 'pl_PL',
  'pt-br': 'pt_BR', ru: 'ru_RU', es: 'es_ES', tr: 'tr_TR', uk: 'uk_UA', vi: 'vi_VN',
};

/**
 * UI strings that live in the template rather than the prose, so translators
 * never had to see them. A content file may override any of these by defining
 * the same key.
 */
const UI = {
  more: {
    en: '...more', ar: '...المزيد', zh: '...展开', nl: '...meer', fr: '...plus',
    de: '...mehr', hi: '...और', id: '...selengkapnya', it: '...altro', ja: '...もっと見る',
    ko: '...더 보기', pl: '...więcej', 'pt-br': '...mais', ru: '...ещё', es: '...más',
    tr: '...devamı', uk: '...ще', vi: '...xem thêm',
  },
  less: {
    en: 'less', ar: 'أقل', zh: '收起', nl: 'minder', fr: 'moins',
    de: 'weniger', hi: 'कम', id: 'tutup', it: 'meno', ja: '閉じる',
    ko: '접기', pl: 'mniej', 'pt-br': 'menos', ru: 'свернуть', es: 'menos',
    tr: 'daha az', uk: 'згорнути', vi: 'thu gọn',
  },
  copied: {
    en: 'Copied!', ar: 'تم النسخ!', zh: '已复制!', nl: 'Gekopieerd!', fr: 'Copié !',
    de: 'Kopiert!', hi: 'कॉपी हो गया!', id: 'Disalin!', it: 'Copiato!', ja: 'コピーしました',
    ko: '복사됨', pl: 'Skopiowano!', 'pt-br': 'Copiado!', ru: 'Скопировано!', es: '¡Copiado!',
    tr: 'Kopyalandı!', uk: 'Скопійовано!', vi: 'Đã sao chép!',
  },
  language: {
    en: 'Language', ar: 'اللغة', zh: '语言', nl: 'Taal', fr: 'Langue',
    de: 'Sprache', hi: 'भाषा', id: 'Bahasa', it: 'Lingua', ja: '言語',
    ko: '언어', pl: 'Język', 'pt-br': 'Idioma', ru: 'Язык', es: 'Idioma',
    tr: 'Dil', uk: 'Мова', vi: 'Ngôn ngữ',
  },
  shareAria: {
    en: 'Share this page', ar: 'شارك هذه الصفحة', zh: '分享此页面', nl: 'Deel deze pagina',
    fr: 'Partager cette page', de: 'Diese Seite teilen', hi: 'यह पेज साझा करें',
    id: 'Bagikan halaman ini', it: 'Condividi questa pagina', ja: 'このページを共有',
    ko: '이 페이지 공유', pl: 'Udostępnij tę stronę', 'pt-br': 'Compartilhar esta página',
    ru: 'Поделиться страницей', es: 'Compartir esta página', tr: 'Bu sayfayı paylaş',
    uk: 'Поділитися сторінкою', vi: 'Chia sẻ trang này',
  },
};

/* ------------------------------------------------------------------ helpers */

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Minimal inline markdown: [text](url), **bold**, *italic*, plus paragraph
 * breaks. Input is escaped first, so content files can never inject markup.
 */
function inline(src) {
  let out = esc(src);
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
  out = out
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, '<br>'))
    .join('<br><br>');
  return out;
}

const byLang = (map, lang, fallback = 'en') => map[lang] ?? map[fallback];

/* ----------------------------------------------------------------- template */

const SHARE_ICON =
  '<svg class="share-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle>' +
  '<line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>';

const CHECK_ICON =
  '<svg class="share-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
  '<polyline points="20 6 9 17 4 12"></polyline></svg>';

const SOCIAL_ICONS = {
  github:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.08 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.95 0-1.31.47-2.39 1.24-3.23-.13-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.25 2.88.12 3.18.77.84 1.24 1.92 1.24 3.23 0 4.62-2.81 5.64-5.49 5.94.43.37.81 1.1.81 2.22v3.29c0 .32.21.7.83.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z"/></svg>',
  linkedin:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zm1.78 13.02H3.55V9h3.57v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.4l-5.8-7.58-6.64 7.58H.47l8.6-9.83L0 1.15h7.59l5.24 6.93 6.07-6.93zm-1.29 19.5h2.04L6.48 3.24H4.29l13.32 17.41z"/></svg>',
};

function renderPage(t, all, css) {
  const lang = t.lang;
  const dir = t.dir || 'ltr';
  const isDefault = lang === 'en';
  const url = isDefault ? `${SITE}/` : `${SITE}/${lang}/`;
  const ui = (key) => t[`${key}Label`] ?? byLang(UI[key], lang);

  const alternates = ORDER.filter((l) => all.has(l))
    .map((l) => {
      const href = l === 'en' ? `${SITE}/` : `${SITE}/${l}/`;
      const hl = l === 'zh' ? 'zh-Hans' : l === 'pt-br' ? 'pt-BR' : l;
      return `    <link rel="alternate" hreflang="${hl}" href="${href}">`;
    })
    .join('\n');

  const t0 = t.time0 || '2:15 PM';
  const t1 = t.time1 || '2:16 PM';

  const message = (who, time, body, cls = '') => `
        <div class="chat-message">
            <div class="avatar ${who}"></div>
            <div class="message-content">
                <div class="message-header">
                    <span class="username">${esc(who === 'you' ? t.you : t.them)}</span>
                    <span class="timestamp">${esc(time)}</span>
                </div>
                <div class="message-text${cls ? ` ${cls}` : ''}">${body}</div>
            </div>
        </div>`;

  const langSwitcher = ORDER.filter((l) => all.has(l))
    .map((l) => {
      const name = esc(all.get(l).name);
      if (l === lang) return `<span aria-current="page">${name}</span>`;
      const href = l === 'en' ? '/' : `/${l}/`;
      return `<a href="${href}" hreflang="${l}" lang="${l}">${name}</a>`;
    })
    .join('\n        ');

  const whereList = `<ul class="where-list">\n${t.whereList
    .map((i) => `        <li>${inline(i)}</li>`)
    .join('\n')}\n    </ul>`;

  return `<!DOCTYPE html>
<html lang="${esc(lang)}"${dir === 'rtl' ? ' dir="rtl"' : ''}>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">

    <title>${esc(t.title)}</title>
    <meta name="description" content="${esc(t.description)}">
    <meta name="author" content="${esc(AUTHOR.name)}">
    <meta name="theme-color" content="#ffffff">

    <meta property="og:url" content="${url}">
    <meta property="og:type" content="website">
    <meta property="og:title" content="${esc(t.ogTitle)}">
    <meta property="og:site_name" content="No Bot Reply">
    <meta property="og:description" content="${esc(t.ogDescription)}">
    <meta property="og:image" content="${SITE}/og-image.png">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="${esc(t.ogTitle)}">
    <meta property="og:locale" content="${OG_LOCALE[lang] || 'en_US'}">

    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:domain" content="nobotreply.com">
    <meta name="twitter:url" content="${url}">
    <meta name="twitter:title" content="${esc(t.ogTitle)}">
    <meta name="twitter:description" content="${esc(t.ogDescription)}">
    <meta name="twitter:image" content="${SITE}/og-image.png">
    <meta name="twitter:creator" content="@dprophecyguy">

    <link rel="canonical" href="${url}">
${alternates}
    <link rel="alternate" hreflang="x-default" href="${SITE}/">

    <link rel="icon" type="image/svg+xml" href="/favicon.svg">

    <script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'No Bot Reply',
      url: url,
      inLanguage: lang,
      author: { '@type': 'Person', name: AUTHOR.name, url: AUTHOR.github },
    })}</script>

    <style>
${css}
    </style>
</head>
<body>

<h1>${esc(t.h1)}</h1>
<p class="tagline">${esc(t.tagline)}</p>

<div class="example-section">
    <div class="section-label bad">${esc(t.labelBad)}</div>
    <div class="chat-window">${message('you', t0, esc(t.chatQuestion))}${message(
      'them',
      t1,
      `<span id="preview">${esc(t.chatSlopPreview)}<span class="hidden-content" id="full-text">${inline(
        t.chatSlopFull
      )}</span></span> <button type="button" class="expand-toggle" id="expand-btn" onclick="toggleExpand()" aria-expanded="false" aria-controls="full-text" data-more="${esc(
        ui('more')
      )}" data-less="${esc(ui('less'))}">${esc(ui('more'))}</button>`,
      'slop'
    )}
    </div>
</div>

<div class="example-section">
    <div class="section-label good">${esc(t.labelGood)}</div>
    <div class="chat-window">${message('you', t0, esc(t.chatQuestion))}${message(
      'them',
      t0,
      esc(t.chatAnswer)
    )}
    </div>
</div>

<div class="example-section">
    <div class="section-label none">${esc(t.labelNone)}</div>
    <div class="chat-window">${message('them', t0, esc(t.chatBlast))}
    </div>
    <p class="caption">${esc(t.chatNoReplyNote)}</p>
</div>

<script>
function toggleExpand() {
    var fullText = document.getElementById('full-text');
    var btn = document.getElementById('expand-btn');
    var isHidden = fullText.style.display === 'none' || fullText.style.display === '';
    fullText.style.display = isHidden ? 'inline' : 'none';
    btn.textContent = isHidden ? btn.dataset.less : btn.dataset.more;
    btn.setAttribute('aria-expanded', String(isHidden));
}
</script>

<h2>${esc(t.h2What)}</h2>
<p>${inline(t.pWhat1)}</p>
<p>${inline(t.pWhat2)}</p>

<h2>${esc(t.h2Why)}</h2>
<p>${inline(t.pWhy1)}</p>
<p>${inline(t.pWhy2)}</p>
<p>${inline(t.pWhy3)}</p>

<h2>${esc(t.h2Where)}</h2>
<p>${inline(t.pWhere1)}</p>
    ${whereList}
<p>${inline(t.pWhere2)}</p>

<hr class="divider">

<p class="principle">${inline(t.principle)}</p>

<p class="quote-intro">${inline(t.quoteIntro)}</p>
<p class="quote">${inline(t.quote)}</p>

<hr class="divider">

<div class="share-cta">
    <p>${esc(t.ctaLabel)}</p>
    <button type="button" class="share-link" id="share-link" data-url="${isDefault ? SITE : url}" data-title="${esc(
      t.ogTitle
    )}" data-text="${esc(t.shareText)}" data-copied="${esc(ui('copied'))}" onclick="shareLink(event)">
        ${SHARE_ICON}
        ${esc(t.siteLabel)}
    </button>
</div>

<script>
var CHECK_ICON = '${CHECK_ICON.replace(/'/g, "\\'")}';
function shareLink(event) {
    event.preventDefault();
    var link = document.getElementById('share-link');
    var url = link.dataset.url;
    if (navigator.share) {
        navigator.share({ title: link.dataset.title, text: link.dataset.text, url: url })
            .catch(function () { copyToClipboard(url); });
    } else {
        copyToClipboard(url);
    }
}
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(function () {
        var link = document.getElementById('share-link');
        if (!link.dataset.original) link.dataset.original = link.innerHTML;
        link.innerHTML = CHECK_ICON + link.dataset.copied;
        setTimeout(function () { link.innerHTML = link.dataset.original; }, 2000);
    });
}
</script>

<footer>
    <nav class="lang-switcher" aria-label="${esc(ui('language'))}">
        ${langSwitcher}</nav>
    <p class="made-by">${esc(t.footerMadeBy)} <a href="${AUTHOR.github}" rel="me noopener">${esc(
      AUTHOR.name
    )}</a></p>
    <div class="socials">
        <a href="${AUTHOR.github}" rel="me noopener" aria-label="GitHub" title="GitHub">${SOCIAL_ICONS.github}</a>
        <a href="${AUTHOR.linkedin}" rel="me noopener" aria-label="LinkedIn" title="LinkedIn">${
      SOCIAL_ICONS.linkedin
    }</a>
        <a href="${AUTHOR.x}" rel="me noopener" aria-label="X" title="X">${SOCIAL_ICONS.x}</a>
    </div>
    <p>${inline(t.footerInspired)}</p>
</footer>

</body>
</html>
`;
}

/* --------------------------------------------------------------------- build */

const REQUIRED = [
  'lang', 'name', 'title', 'description', 'ogTitle', 'ogDescription', 'shareText',
  'h1', 'tagline', 'labelBad', 'labelGood', 'labelNone', 'you', 'them',
  'chatQuestion', 'chatSlopPreview', 'chatSlopFull', 'chatAnswer', 'chatBlast',
  'chatNoReplyNote', 'h2What', 'pWhat1', 'pWhat2', 'h2Why', 'pWhy1', 'pWhy2',
  'pWhy3', 'h2Where', 'pWhere1', 'whereList', 'pWhere2', 'principle',
  'quoteIntro', 'quote', 'ctaLabel', 'siteLabel', 'footerMadeBy', 'footerInspired',
];

function validate(t, file) {
  const problems = [];
  for (const key of REQUIRED) {
    if (t[key] === undefined || t[key] === null || t[key] === '') problems.push(`missing "${key}"`);
  }
  if (!Array.isArray(t.whereList) || t.whereList.length < 4) problems.push('"whereList" must be an array of 4+ items');
  if (t.lang && file !== `${t.lang}.json`) problems.push(`lang "${t.lang}" does not match filename "${file}"`);
  for (const key of ['chatSlopPreview', 'chatSlopFull', 'pWhy1', 'quoteIntro', 'footerInspired']) {
    if (typeof t[key] === 'string' && /\[[^\]]*\]\([^)]*\)/.test(t[key]) && !/\]\(https?:\/\//.test(t[key])) {
      problems.push(`"${key}" has a malformed markdown link`);
    }
  }
  if (/^[A-Z]/.test(t.h1 || '')) problems.push('"h1" should stay lowercase');
  return problems;
}

async function main() {
  const css = await readFile(join(ROOT, 'src', 'style.css'), 'utf8');

  // Skip dotfiles: macOS tar/rsync drops `._xx.json` AppleDouble stubs next to
  // real files and they must never be treated as content.
  const files = (await readdir(CONTENT_DIR))
    .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
    .sort();
  const all = new Map();
  const problems = [];

  for (const file of files) {
    const raw = await readFile(join(CONTENT_DIR, file), 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      problems.push(`${file}: invalid JSON — ${err.message}`);
      continue;
    }
    const errs = validate(parsed, file);
    if (errs.length) problems.push(`${file}: ${errs.join('; ')}`);
    all.set(parsed.lang, parsed);
  }

  const missing = ORDER.filter((l) => !all.has(l));
  if (missing.length) problems.push(`missing translations for: ${missing.join(', ')}`);

  if (problems.length) {
    console.error('\n  content problems:\n');
    for (const p of problems) console.error(`   ✕ ${p}`);
    console.error('');
    if (process.env.STRICT) process.exit(1);
  }

  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  let bytes = 0;
  for (const lang of ORDER) {
    const t = all.get(lang);
    if (!t) continue;
    const html = renderPage(t, all, css);
    bytes += Buffer.byteLength(html);
    const out = lang === 'en' ? join(DIST, 'index.html') : join(DIST, lang, 'index.html');
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, html);
  }

  // static assets
  for (const asset of await readdir(join(ROOT, 'public'))) {
    const buf = await readFile(join(ROOT, 'public', asset));
    await writeFile(join(DIST, asset), buf);
  }

  // 404 — English, points home
  const en = all.get('en');
  if (en) {
    await writeFile(
      join(DIST, '404.html'),
      renderPage({ ...en, title: '404 — No Bot Reply', h1: '404.', tagline: en.tagline }, all, css)
    );
  }

  // robots.txt
  await writeFile(
    join(DIST, 'robots.txt'),
    `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`
  );

  // sitemap.xml with hreflang alternates
  const langs = ORDER.filter((l) => all.has(l));
  const href = (l) => (l === 'en' ? `${SITE}/` : `${SITE}/${l}/`);
  const alternates = langs
    .map((l) => `    <xhtml:link rel="alternate" hreflang="${l === 'zh' ? 'zh-Hans' : l === 'pt-br' ? 'pt-BR' : l}" href="${href(l)}"/>`)
    .join('\n');
  const today = new Date().toISOString().slice(0, 10);
  const urls = langs
    .map(
      (l) => `  <url>
    <loc>${href(l)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
${alternates}
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/"/>
  </url>`
    )
    .join('\n');
  await writeFile(
    join(DIST, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`
  );

  // Cloudflare Pages / Netlify headers: assets are immutable, HTML is not.
  await writeFile(
    join(DIST, '_headers'),
    `/favicon.svg
  Cache-Control: public, max-age=31536000, immutable

/og-image.png
  Cache-Control: public, max-age=31536000, immutable

/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
`
  );

  const langsBuilt = langs.length;
  console.log(
    `  ✓ built ${langsBuilt} languages + 404 + sitemap + robots → dist/  (${(
      bytes / 1024
    ).toFixed(1)} KB HTML total, ${(bytes / langsBuilt / 1024).toFixed(1)} KB per page)`
  );
  if (problems.length) process.exitCode = 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
