// scripts/update.js — CommonJS, Node 18+, без внешних зависимостей
// Парсит https://khoindvn.io.vn/ и формирует data/statuses.json + data/khoindvn.json

const fs = require('node:fs');
const path = require('node:path');

const BASE = 'https://khoindvn.io.vn/';

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'kalamit-sync/1.0' } });
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
  return r.text();
}
const toAbs = (h) => { try { return new URL(h, BASE).href } catch { return null } };

function classify(href, text='') {
  const h = href.toLowerCase();
  const t = String(text).toLowerCase();
  if (h.endsWith('.ipa') || t.includes('ipa')) return 'app';
  if (/\.(cer|crt|pem)\b/i.test(h) || t.includes('cert')) return 'certificate';
  if (h.endsWith('.mobileconfig') || /dns|profile/.test(t)) return 'dns';
  return null;
}

// Простой сбор всех <a href="...">текст</a> без внешних либ
function extractLinks(html) {
  const out = [];
  const re = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = toAbs(m[1].trim());
    if (!href) continue;
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || href;
    out.push({ href, text });
  }
  return out;
}

// Доступность: HEAD → (если нет) GET
async function reachable(url) {
  try {
    const h = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    if (h.ok || (h.status >= 200 && h.status < 400)) return true;
  } catch {}
  try {
    const g = await fetch(url, { method: 'GET', redirect: 'follow' });
    return g.ok || (g.status >= 200 && g.status < 400);
  } catch {
    return false;
  }
}

// Ограничитель параллельности
async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

function idFromName(name, fallbackPrefix, idx) {
  const n = String(name).toLowerCase();
  if (n.includes('esign') && n.includes('vnj')) return 'esign-vnj';
  if (n.includes('esign')) return 'esign';
  if (n.includes('ksign') && n.includes('bmw')) return 'ksign-bmw';
  if (n.includes('ksign')) return 'ksign';
  return `${fallbackPrefix}-${idx + 1}`;
}

async function main() {
  const html = await fetchText(BASE);
  const links = extractLinks(html);

  // Классифицируем ссылки по типам (приложения/сертификаты/DNS)
  const items = [];
  for (const L of links) {
    const kind = classify(L.href, L.text);
    if (!kind) continue;
    items.push({ kind, name: L.text, url: L.href });
  }

  // Проверяем доступность (это и будет “статус”)
  await mapLimit(items, 6, async (it) => {
    it.status = await reachable(it.url);
    return it;
  });

  // Дедуплим по URL и раскладываем в формат фронтенда
  const seen = new Set();
  const tools = [];
  const certificates = [];

  items.forEach((it, i) => {
    if (seen.has(it.url)) return;
    seen.add(it.url);

    if (it.kind === 'app') {
      tools.push({
        id: idFromName(it.name, 'app', tools.length),
        name: it.name,
        status: !!it.status,
        description: 'Ссылка с khoindvn.io.vn',
        url: it.url
      });
    } else {
      certificates.push({
        id: idFromName(it.name, 'cert', certificates.length),
        name: it.kind === 'dns' ? 'DNS / Profile' : 'Certificate',
        description: it.name,
        url: it.url
      });
    }
  });

  // Пишем файлы данных
  const outDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(outDir, { recursive: true });

  const statuses = { tools, certificates };
  fs.writeFileSync(path.join(outDir, 'statuses.json'), JSON.stringify(statuses, null, 2), 'utf8');

  const khoindvn = {
    source: BASE,
    last_synced: new Date().toISOString(),
    apps: tools,
    certificates,
  };
  fs.writeFileSync(path.join(outDir, 'khoindvn.json'), JSON.stringify(khoindvn, null, 2), 'utf8');

  console.log(`OK: tools=${tools.length}, certificates=${certificates.length}`);
}

main().catch((e) => {
  console.error('UPDATE FAILED:', e);
  process.exit(1);
});
