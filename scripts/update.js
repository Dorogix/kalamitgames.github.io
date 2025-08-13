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

// --- классификация и "красота" ---
const isIpa = (u) => /\.ipa(\?|$)/i.test(u);
const isRawZip = (u) => /\.(zip|rar|7z)(\?|$)/i.test(u);
const isCertFile = (u) => /\.(cer|crt|pem)(\?|$)/i.test(u);
const isMobileConfig = (u) => /\.mobileconfig(\?|$)/i.test(u);

function classify(href, text='') {
  const h = href.toLowerCase();
  const t = String(text).toLowerCase();
  if (isIpa(h) || /ksign|esign/.test(t) || /ksign|esign/.test(h)) return 'app';
  if (isMobileConfig(h) || /dns|profile/.test(t) || /dns/.test(h)) return 'dns';
  if (isCertFile(h) || /cert/.test(t) || /cert/.test(h) || isRawZip(h)) return 'certificate';
  return null;
}

function extractLinks(html) {
  const out = [];
  const re = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = toAbs((m[1] || '').trim());
    if (!href) continue;
    const text = (m[2] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    out.push({ href, text: text || href });
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
      const idx = i++; out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

function pickBestLink(candidates) {
  // приоритет: .ipa → github/raw → остальное
  let best = null;
  for (const c of candidates) {
    if (!best) best = c;
    const u = c.href.toLowerCase();
    const score =
      (isIpa(u) ? 3 : 0) +
      (u.includes('raw.githubusercontent.com') || u.includes('/raw/') ? 2 : 0) +
      1;
    c._score = score;
  }
  candidates.sort((a,b)=> (b._score||0)-(a._score||0));
  return candidates[0];
}

function niceCertName(kind, url, rawText) {
  const host = (()=>{ try{ return new URL(url).host }catch{ return '' } })();
  if (kind === 'dns') return 'DNS / Profile';
  if (host.startsWith('cert.')) return 'Certificate Pack';
  if (url.toLowerCase().includes('github')) return 'Certificate Pack';
  if (isCertFile(url)) return 'Certificate';
  return 'Certificate';
}
function shortDesc(url, rawText) {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    if (last) return last;
    return u.host;
  } catch { return rawText.slice(0, 60); }
}

function idFrom(text, fallback, i) {
  const t = text.toLowerCase();
  if (t.includes('ksign') && t.includes('bmw')) return 'ksign-bmw';
  if (t.includes('ksign')) return 'ksign';
  if (t.includes('esign') && t.includes('vnj')) return 'esign-vnj';
  if (t.includes('esign')) return 'esign';
  return `${fallback}-${i+1}`;
}

async function main() {
  const html = await fetchText(BASE);
  const links = extractLinks(html);

  // Сгруппируем по "семействам" инструментов, чтобы выбрать лучшую ссылку
  const groups = {
    ksign: [], esign: [], 'ksign-bmw': [], 'esign-vnj': []
  };
  const certs = [];
  const dns = [];

  for (const L of links) {
    const kind = classify(L.href, L.text);
    if (!kind) continue;

    const txt = (L.text || '').toLowerCase();
    if (kind === 'app') {
      if (txt.includes('ksign') && txt.includes('bmw')) groups['ksign-bmw'].push(L);
      else if (txt.includes('ksign')) groups.ksign.push(L);
      else if (txt.includes('esign') && txt.includes('vnj')) groups['esign-vnj'].push(L);
      else if (txt.includes('esign')) groups.esign.push(L);
      else groups.ksign.push(L); // в сомнительных случаях пусть уйдёт в ksign
    } else if (kind === 'dns') {
      dns.push(L);
    } else if (kind === 'certificate') {
      certs.push(L);
    }
  }

  // Собираем tools
  const tools = [];
  for (const [key, arr] of Object.entries(groups)) {
    if (!arr.length) continue;
    const best = pickBestLink(arr);
    const name =
      key === 'ksign-bmw' ? 'KSign BMW' :
      key === 'esign-vnj' ? 'eSign VNJ' :
      key === 'esign' ? 'eSign' : 'KSign';

    tools.push({ id: key, name, url: best.href, status: false, description: 'Ссылка с khoindvn.io.vn' });
  }

  // Проверяем доступность (статусы)
  await mapLimit(tools, 6, async (t)=>{ t.status = await reachable(t.url); return t; });

  // Сертификаты и DNS (красивые имена + описание)
  const certificates = [];
  const seen = new Set();
  for (const item of [...dns.map(x=>({kind:'dns',...x})), ...certs.map(x=>({kind:'certificate',...x}))]) {
    if (seen.has(item.href)) continue; seen.add(item.href);
    const name = niceCertName(item.kind, item.href, item.text);
    const desc = shortDesc(item.href, item.text);
    certificates.push({
      id: idFrom(name + ' ' + desc, 'cert', certificates.length),
      name,
      description: desc,
      url: item.href
    });
  }

  // Запись файлов
  const outDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(outDir, { recursive: true });

  const statuses = { tools, certificates };
  fs.writeFileSync(path.join(outDir, 'statuses.json'), JSON.stringify(statuses, null, 2), 'utf8');

  const khoindvn = {
    source: BASE,
    last_synced: new Date().toISOString(),
    apps: tools,
    certificates
  };
  fs.writeFileSync(path.join(outDir, 'khoindvn.json'), JSON.stringify(khoindvn, null, 2), 'utf8');

  console.log(`OK: tools=${tools.length}, certificates=${certificates.length}`);
}

main().catch(e => { console.error('UPDATE FAILED:', e); process.exit(1); });
