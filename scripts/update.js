// scripts/update.js (CommonJS, Node 18+, без зависимостей)

const fs = require('node:fs');
const path = require('node:path');

const BASE = 'https://khoindvn.io.vn/';

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'kalamit-sync/1.0' } });
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
  return r.text();
}
const toAbs = (h) => { try { return new URL(h, BASE).href } catch { return null } };
const kindOf = (href, text='') => {
  const h = href.toLowerCase(), t = text.toLowerCase();
  if (h.endsWith('.ipa') || t.includes('ipa')) return 'app';
  if (/\.(cer|crt|pem)\b/i.test(h) || t.includes('cert')) return 'certificate';
  if (h.endsWith('.mobileconfig') || /dns|profile/.test(t)) return 'dns';
  return null;
};
function links(html) {
  const out = [];
  const re = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m; while ((m = re.exec(html))) {
    const href = toAbs(m[1].trim()); if (!href) continue;
    const text = m[2].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim() || href;
    out.push({ href, text });
  }
  return out;
}
async function reachable(url) {
  try {
    const h = await fetch(url, { method:'HEAD', redirect:'follow' });
    if (h.ok || (h.status>=200 && h.status<400)) return true;
  } catch {}
  try {
    const g = await fetch(url, { method:'GET', redirect:'follow' });
    return g.ok || (g.status>=200 && g.status<400);
  } catch { return false }
}
async function mapLimit(arr, n, fn) {
  const out = []; let i=0;
  await Promise.all(Array.from({length: Math.min(n, arr.length)}, async () => {
    while (i < arr.length) { const idx = i++; out[idx] = await fn(arr[idx], idx); }
  }));
  return out;
}

async function main() {
  const html = await fetchText(BASE);
  const all = links(html);

  const items = [];
  for (const L of all) {
    const kind = kindOf(L.href, L.text);
    if (!kind) continue;
    items.push({ kind, name: L.text, url: L.href });
  }

  await mapLimit(items, 6, async (it) => { it.status = await reachable(it.url); return it; });

  const tools = [];
  const certificates = [];
  const seen = new Set();

  for (const it of items) {
    if (seen.has(it.url)) continue; seen.add(it.url);
    if (it.kind === 'app') {
      tools.push({
        id: it.name.toLowerCase().includes('esign') ? 'esign'
           : it.name.toLowerCase().includes('bmw') ? 'ksign-bmw'
           : it.name.toLowerCase().includes('ksign') ? 'ksign'
           : it.name.toLowerCase().includes('vnj') ? 'esign-vnj'
           : `app-${tools.length+1}`,
        name: it.name,
        status: !!it.status,
        description: 'Ссылка с khoindvn.io.vn',
        url: it.url
      });
    } else {
      certificates.push({
        id: `cert-${certificates.length+1}`,
        name: it.kind === 'dns' ? 'DNS / Profile' : 'Certificate',
        description: it.name,
        url: it.url
      });
    }
  }

  const payload = { tools, certificates };
  const outDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'statuses.json'), JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Updated data/statuses.json: ${tools.length} tools, ${certificates.length} certificates`);
}

main().catch(e => { console.error(e); process.exit(1); });
