// scripts/update.js — CommonJS, Node 18+, без внешних зависимостей

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

// ---- pretty helpers ----
function fileName(url) {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() || '';
    return decodeURIComponent(last);
  } catch { return '' }
}
function host(url) {
  try { return new URL(url).host } catch { return '' }
}
function prettyCertName(url, rawText, kind) {
  const f = fileName(url).toLowerCase();
  const h = host(url).toLowerCase();

  if (kind === 'dns') return 'DNS / Profile';
  if (f.includes('cert') || h.startsWith('cert.')) return 'Certificate Pack';
  if (f.endsWith('.cer') || f.endsWith('.crt') || f.endsWith('.pem')) return 'Certificate';
  if (h.includes('github')) return 'Certificate Pack';
  return 'Certificate';
}
function prettyCertDesc(url, rawText) {
  const f = fileName(url);
  if (f) return f;                       // показываем читабельное имя файла
  if (rawText && rawText.length < 60) return rawText;
  return host(url) || url;               // коротко
}

// ------------------------

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

async function reachable(url) {
  try {
    const h = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    if (h.ok || (h.status >= 200 && h.status < 400)) return true;
  } catch {}
  try {
    const g = await fetch(url, { method: 'GET', redirect: 'follow' });
    return g.ok || (g.status >= 200 && g.status < 400);
  } catch { return false }
}

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

  const items = [];
  for (const L of links) {
    const kind = classify(L.href, L.text);
    if (!kind) continue;
    items.push({ kind, name: L.text, url: L.href });
  }

  await mapLimit(items, 6, async (it) => {
    it.status = await reachable(it.url);
    return it;
  });

  // Сборка итогового JSON
  const seen = new Set();
  const tools = [];
  const certificates = [];

  items.forEach((it, i) => {
    if (seen.has(it.url)) return;
    seen.add(it.url);

    if (it.kind === 'app') {
      tools.push({
        id: idFromName(it.name, 'app', tools.length),
        name: it.name,                      // реальное имя из источника
        status: !!it.status,                // ✔/✖
        description: 'Ссылка с khoindvn.io.vn',
        url: it.url
      });
    } else {
      const friendlyName = prettyCertName(it.url, it.name, it.kind);
      const desc = prettyCertDesc(it.url, it.name);
      certificates.push({
        id: idFromName(friendlyName + '-' + desc, 'cert', certificates.length),
        name: friendlyName,                 // красивое короткое имя
        description: desc,                  // короткое описание (имя файла/хост)
        url: it.url
      });
    }
  });

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
