// scripts/update.js
// Парсит khoindvn.io.vn и пишет data/statuses.json в формате,
// который ожидает твой script.js: { tools: [...], certificates: [...] }

const fs = require('fs');
const path = require('path');
const { load } = require('cheerio');

const BASE = 'https://khoindvn.io.vn/';
const OUT_DIR = path.join('data');
const OUT_FILE = path.join(OUT_DIR, 'statuses.json');

// Утилиты
const sleep = ms => new Promise(r => setTimeout(r, ms));

function slugify(s) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40) || 'item';
}

function inferId(name) {
  const n = name.toLowerCase();
  if (n.includes('ksign') && n.includes('bmw')) return 'ksign-bmw';
  if (n.includes('ksign')) return 'ksign';
  if (n.includes('esign') && n.includes('vnj')) return 'esign-vnj';
  if (n.includes('esign')) return 'esign';
  return slugify(name);
}

function classify(href, text) {
  const t = (text || '').toLowerCase();
  const h = (href || '').toLowerCase();
  const isIPA = /\.ipa($|\?)/.test(h) || t.includes('ipa');
  const isCert = /\.(cer|crt|pem|p12|pfx)($|\?)/.test(h) || t.includes('cert');
  const isMobileConf = /\.mobileconfig($|\?)/.test(h) || t.includes('dns') || t.includes('profile');
  if (isIPA) return 'app';
  if (isCert || isMobileConf) return 'certificate';
  return null;
}

async function headOk(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    return r.status >= 200 && r.status < 400;
  } catch {
    return false;
  }
}

function absUrl(href) {
  try {
    return new URL(href, BASE).toString();
  } catch {
    return null;
  }
}

async function fetchHTML(url) {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.text();
}

async function parseIndex() {
  const html = await fetchHTML(BASE);
  const $ = load(html);
  const items = [];

  $('a[href]').each((_, a) => {
    const hrefRaw = $(a).attr('href')?.trim();
    const href = absUrl(hrefRaw || '');
    if (!href) return;
    const text = $(a).text().trim() || href;
    const kind = classify(href, text);
    if (!kind) return;

    items.push({ kind, name: text, url: href });
  });

  // Проверка доступности ссылок (бережно)
  for (const it of items) {
    it.status = await headOk(it.url);
    await sleep(150);
  }

  // Преобразуем в формат, который ждёт твой фронтенд
  const tools = [];
  const certificates = [];

  for (const it of items) {
    const entry = {
      id: inferId(it.name),
      name: it.name,
      status: Boolean(it.status),
      description:
        it.kind === 'app'
          ? 'Автоматически найдено на khoindvn.io.vn'
          : 'Ссылка с khoindvn.io.vn',
      url: it.url,
    };
    if (it.kind === 'app') tools.push(entry);
    else certificates.push(entry);
  }

  // Гарантируем наличие массива (чтобы фронт не падал)
  return { tools, certificates };
}

async function main() {
  const data = await parseIndex();

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(data, null, 2), 'utf8');

  console.log(`Wrote ${OUT_FILE}`);
  console.log(`tools: ${data.tools.length}, certificates: ${data.certificates.length}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
