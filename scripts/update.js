// scripts/update.js — Node 18+, CommonJS, без внешних пакетов
// Собирает данные с https://khoindvn.io.vn/ и пишет:
//   data/statuses.json   ← для фронта (tools + certificates + dns)
//   data/khoindvn.json   ← доп. инфо с last_synced

const fs = require('node:fs');
const path = require('node:path');

const BASE = 'https://khoindvn.io.vn/';

// ---------- утилиты ----------
async function fetchText(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'kalamit-sync/1.0' } });
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
  return r.text();
}
const toAbs = (h) => { try { return new URL(h, BASE).href } catch { return null } };

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

function fileName(url) {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() || '';
    return decodeURIComponent(last);
  } catch { return '' }
}
function host(url) { try { return new URL(url).host } catch { return '' } }

// ---------- классификация/скоринг ----------
const isIpa          = (u) => /\.ipa(\?|$)/i.test(u);
const isArchive      = (u) => /\.(zip|rar|7z)(\?|$)/i.test(u);
const isCertFile     = (u) => /\.(cer|crt|pem)(\?|$)/i.test(u);
const isMobileConfig = (u) => /\.mobileconfig(\?|$)/i.test(u);
const hasCertish     = (u) => /cert|certificate/i.test(u);
const hasDnsish      = (u) => /dns|profile/i.test(u);
const isDocPath      = (u) => /document|docs?|downloads?\/dns/i.test(u);

function classify(href, text='') {
  const h = href.toLowerCase();
  const t = String(text).toLowerCase();

  if (isMobileConfig(h) || hasDnsish(h) || hasDnsish(t)) return 'dns';
  if (isCertFile(h) || isArchive(h) || hasCertish(h) || /certs?/i.test(t)) return 'certificate';

  if (isIpa(h)) return 'app';
  if (/ksign|esign/.test(t) || /ksign|esign/.test(h)) return 'app';
  return null;
}

function looksLikeNotApp(u) {
  return (
    isArchive(u) || isCertFile(u) || isMobileConfig(u) ||
    hasCertish(u) || hasDnsish(u) || isDocPath(u)
  );
}

function pickBestLink(candidates, toolKey) {
  let pool = candidates.filter(c => !looksLikeNotApp(c.href.toLowerCase()));
  if (pool.length === 0) pool = candidates.slice();

  const rxTool = toolKey === 'ksign-bmw' ? /bmw|ksign/i
              : toolKey === 'esign-vnj' ? /vnj|esign/i
              : toolKey === 'esign'     ? /esign/i
              : /ksign/i;

  for (const c of pool) {
    const u = c.href.toLowerCase();
    const t = c.text.toLowerCase();
    let score = 0;

    if (isIpa(u)) score += 100;                                        // .ipa — топ
    if (rxTool.test(u) || rxTool.test(t)) score += 30;                 // совпадение имени
    if (/download|install|release|raw/.test(u)) score += 10;           // слова-сигналы
    if (u.includes('raw.githubusercontent.com') || u.includes('/raw/')) score += 8;
    if (u.includes('github.com')) score += 5;

    if (u.includes('document/') || u.includes('/dns') || u.includes('cert')) score -= 40;
    c._score = score;
  }
  pool.sort((a,b)=> (b._score||0)-(a._score||0));
  return pool[0] || candidates[0];
}

function prettyCertName(kind, url) {
  const h = host(url).toLowerCase();
  if (kind === 'dns') return 'DNS / Profile';
  if (h.startsWith('cert.') || url.toLowerCase().includes('github')) return 'Certificate Pack';
  if (isCertFile(url)) return 'Certificate';
  return 'Certificate';
}

function prettyCertDesc(url, rawText) {
  const f = fileName(url);
  if (f) return f;
  if (rawText && rawText.length < 60) return rawText;
  return host(url) || url;
}

function idFrom(text, fallback, i) {
  const t = text.toLowerCase();
  if (t.includes('ksign') && t.includes('bmw')) return 'ksign-bmw';
  if (t.includes('ksign')) return 'ksign';
  if (t.includes('esign') && t.includes('vnj')) return 'esign-vnj';
  if (t.includes('esign')) return 'esign';
  return `${fallback}-${i+1}`;
}

// ---------- основной код ----------
async function main() {
  const html = await fetchText(BASE);
  const links = extractLinks(html);

  const groups = { ksign: [], esign: [], 'ksign-bmw': [], 'esign-vnj': [] };
  const dns = [];
  const certs = [];

  for (const L of links) {
    const kind = classify(L.href, L.text);
    if (!kind) continue;

    const txt = (L.text || '').toLowerCase();
    if (kind === 'app') {
      if (txt.includes('ksign') && txt.includes('bmw')) groups['ksign-bmw'].push(L);
      else if (txt.includes('ksign')) groups.ksign.push(L);
      else if (txt.includes('esign') && txt.includes('vnj')) groups['esign-vnj'].push(L);
      else if (txt.includes('esign')) groups.esign.push(L);
      else groups.ksign.push(L);
    } else if (kind === 'dns') {
      dns.push(L);
    } else if (kind === 'certificate') {
      certs.push(L);
    }
  }

  // Tools
  const tools = [];
  for (const [key, arr] of Object.entries(groups)) {
    if (!arr.length) continue;
    const best = pickBestLink(arr, key);
    const name =
      key === 'ksign-bmw' ? 'KSign BMW' :
      key === 'esign-vnj' ? 'eSign VNJ' :
      key === 'esign'     ? 'eSign'     : 'KSign';

    tools.push({ id: key, name, url: best.href, status: false, description: 'Ссылка с khoindvn.io.vn' });
  }

  // Проверяем статус ссылок (✔/✖)
  await mapLimit(tools, 6, async (t)=>{ t.status = await reachable(t.url); return t; });

  // Certificates + DNS
  const certificates = [];
  const seen = new Set();
  for (const item of [...dns.map(x=>({kind:'dns',...x})), ...certs.map(x=>({kind:'certificate',...x}))]) {
    if (seen.has(item.href)) continue; seen.add(item.href);
    certificates.push({
      id: idFrom(item.text || item.href, 'cert', certificates.length),
      name: prettyCertName(item.kind, item.href),
      description: prettyCertDesc(item.href, item.text),
      url: item.href
    });
  }

  // DNS главный профиль (первый mobileconfig/DNS)
  const dnsMain = dns.length ? dns[0].href : null;

  const outDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(outDir, { recursive: true });

  // Для фронта
  const statuses = { tools, certificates, dns: { install: dnsMain } };
  fs.writeFileSync(path.join(outDir, 'statuses.json'), JSON.stringify(statuses, null, 2), 'utf8');

  // Доп. инфо
  const khoindvn = { source: BASE, last_synced: new Date().toISOString(), apps: tools, certificates, dns: { install: dnsMain } };
  fs.writeFileSync(path.join(outDir, 'khoindvn.json'), JSON.stringify(khoindvn, null, 2), 'utf8');

  console.log(`OK: tools=${tools.length}, certificates=${certificates.length}, dns=${dnsMain ? '1' : '0'}`);
}

main().catch(e => { console.error('UPDATE FAILED:', e); process.exit(1); });
