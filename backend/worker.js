import { sevenProducts, sevenInventory } from './seven.js';

const UPSTREAM = 'https://mcp.aka.page';
const EMART_WEB = 'https://emart24.co.kr';
const EMART_EVERSE = 'https://everse.emart24.co.kr';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors() },
  });
}

function shortError(e, fallback = '요청 실패') {
  const status = Number(e?.status || 0);
  const raw = String(e?.message || e || '');
  if (status === 403 || /HTTP\s*403/i.test(raw)) return '이마트24 접근 차단(403)';
  if (status === 429 || /HTTP\s*429/i.test(raw)) return '이마트24 요청 제한(429)';
  if (/<!doctype|<html|<head|<body/i.test(raw)) return fallback;
  return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140) || fallback;
}

async function readJson(url, init = {}) {
  const r = await fetch(url, init);
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!r.ok) {
    const msg = body?.error?.message || body?.message || text.slice(0, 180) || `HTTP ${r.status}`;
    const err = new Error(`HTTP ${r.status} · ${msg}`);
    err.status = r.status;
    throw err;
  }
  return body;
}

async function relay(requestUrl, targetPath) {
  const incoming = new URL(requestUrl);
  const target = new URL(UPSTREAM + targetPath);
  for (const [k, v] of incoming.searchParams.entries()) target.searchParams.append(k, v);
  const r = await fetch(target.toString(), {
    method: 'GET',
    headers: { accept: 'application/json' },
    cf: { cacheTtl: 0, cacheEverything: false },
  });
  const text = await r.text();
  return new Response(text, {
    status: r.status,
    headers: {
      'content-type': r.headers.get('content-type') || 'application/json; charset=utf-8',
      ...cors(),
      'x-radar-upstream-status': String(r.status),
    },
  });
}

async function relayJson(requestUrl, targetPath) {
  const incoming = new URL(requestUrl);
  const target = new URL(UPSTREAM + targetPath);
  for (const [k, v] of incoming.searchParams.entries()) target.searchParams.append(k, v);
  const r = await fetch(target.toString(), {
    method: 'GET',
    headers: { accept: 'application/json' },
    cf: { cacheTtl: 0, cacheEverything: false },
  });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  return { ok: r.ok, status: r.status, body };
}

function emartJsonHeaders(cookie = '') {
  const h = {
    Accept: 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    'User-Agent': BROWSER_UA,
    'X-Requested-With': 'XMLHttpRequest',
    Origin: EMART_EVERSE,
    Referer: `${EMART_EVERSE}/stock`,
  };
  if (cookie) h.Cookie = cookie;
  return h;
}

async function emartSessionCookie() {
  try {
    const r = await fetch(`${EMART_EVERSE}/stock`, {
      method: 'GET',
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    const raw = r.headers.get('set-cookie') || '';
    return raw.split(',').map(v => v.split(';')[0].trim()).filter(Boolean).join('; ');
  } catch {
    return '';
  }
}

async function emartReadJson(url, init = {}) {
  try {
    return await readJson(url, init);
  } catch (e) {
    if (e?.status !== 403) throw e;
    const cookie = await emartSessionCookie();
    const headers = { ...(init.headers || {}), ...emartJsonHeaders(cookie) };
    if ((init.method || 'GET').toUpperCase() === 'POST') headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    return readJson(url, { ...init, headers, cf: { cacheTtl: 0, cacheEverything: false } });
  }
}

function normalizeArea1(v = '') {
  const s = String(v);
  const table = [
    ['서울','서울'],['부산','부산'],['대구','대구'],['인천','인천'],['광주','광주'],['대전','대전'],['울산','울산'],['세종','세종'],
    ['경기','경기'],['강원','강원'],['충청북','충북'],['충청남','충남'],['전북','전북'],['전라북','전북'],['전남','전남'],['전라남','전남'],
    ['경북','경북'],['경상북','경북'],['경남','경남'],['경상남','경남'],['제주','제주']
  ];
  for (const [k, out] of table) if (s.includes(k)) return out;
  return s.replace(/특별시|광역시|특별자치시|특별자치도|도$/g, '').trim();
}

async function reverseArea(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { area1: '', area2: '' };
  try {
    const u = new URL('https://nominatim.openstreetmap.org/reverse');
    u.searchParams.set('format', 'jsonv2');
    u.searchParams.set('lat', String(lat));
    u.searchParams.set('lon', String(lng));
    u.searchParams.set('zoom', '12');
    u.searchParams.set('addressdetails', '1');
    const d = await readJson(u.toString(), { headers: { 'User-Agent': 'pokemon-stock-radar/1.0', Accept: 'application/json' } });
    const a = d.address || {};
    return {
      area1: normalizeArea1(a.city || a.state || a.province || ''),
      area2: a.borough || a.city_district || a.county || a.town || '',
    };
  } catch {
    return { area1: '', area2: '' };
  }
}

function distanceM(lat1, lng1, lat2, lng2) {
  const r = 6371000;
  const rad = x => x * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat/2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng/2) ** 2;
  return Math.round(r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

function emartStore(x) {
  return {
    storeCode: String(x.CODE || x.bizNo || ''),
    storeName: x.TITLE || x.storeNm || '',
    address: x.ADDRESS || x.storeAddr || '',
    addressDetail: x.ADDRESS_DE || '',
    phone: x.PHONE || x.tel || '',
    latitude: Number(x.LATITUDE || x.latitude || 0),
    longitude: Number(x.LONGITUDE || x.longitude || 0),
  };
}

async function emartProducts(keyword, page = 1, pageSize = 50) {
  const form = new URLSearchParams({
    currentPage: String(page),
    pageCnt: String(pageSize),
    sortType: 'SALE',
    saleProductYn: 'N',
    searchWord: keyword.trim(),
  });
  const body = await emartReadJson(`${EMART_EVERSE}/stock/stock/search`, {
    method: 'POST',
    headers: { ...emartJsonHeaders(), 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: form.toString(),
    cf: { cacheTtl: 0, cacheEverything: false },
  });
  const rows = Array.isArray(body.productList) ? body.productList : [];
  return rows.map(x => ({
    pluCd: String(x.pluCd || ''),
    goodsName: x.goodsNm || '',
    originPrice: Number(x.originPrice || 0),
    viewPrice: Number(x.viewPrice || 0),
    category: x.categoryNm || '',
    kind: x.kindNm || '',
  })).filter(x => x.pluCd && x.goodsName);
}

async function emartStores(lat, lng, storeLimit = 30) {
  const area = await reverseArea(lat, lng);
  const attempts = [];
  if (area.area1 || area.area2) attempts.push({ AREA1: area.area1, AREA2: area.area2 });
  if (area.area2) attempts.push({ search: area.area2 });
  attempts.push({});

  let stores = [];
  let lastErr = '';
  for (const filters of attempts) {
    try {
      const found = [];
      for (let page = 1; page <= 4; page++) {
        const u = new URL('/api1/store', EMART_WEB);
        u.searchParams.set('page', String(page));
        for (const [k,v] of Object.entries(filters)) if (v) u.searchParams.set(k, v);
        const body = await emartReadJson(u.toString(), { headers: { ...emartJsonHeaders(), Origin: EMART_WEB, Referer: `${EMART_WEB}/store` } });
        const batch = (Array.isArray(body.data) ? body.data : []).map(emartStore).filter(s => s.storeCode);
        found.push(...batch);
        if (!batch.length || found.length >= 120) break;
      }
      if (found.length) { stores = found; break; }
    } catch (e) { lastErr = shortError(e, '이마트24 매장조회 실패'); }
  }
  if (!stores.length && lastErr) throw new Error(lastErr);

  const uniq = new Map();
  for (const s of stores) if (!uniq.has(s.storeCode)) uniq.set(s.storeCode, s);
  return [...uniq.values()].map(s => ({
    ...s,
    distanceM: s.latitude && s.longitude && Number.isFinite(lat) && Number.isFinite(lng)
      ? distanceM(lat, lng, s.latitude, s.longitude) : null,
  })).sort((a,b) => (a.distanceM ?? 1e12) - (b.distanceM ?? 1e12))
    .slice(0, Math.max(1, Math.min(60, storeLimit)));
}

function normalizeQtyRows(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  if (typeof value === 'object') {
    for (const key of ['data','list','items','rows','storeGoodsQty']) if (Array.isArray(value[key])) return value[key];
    return Object.entries(value).flatMap(([key, v]) => {
      if (v && typeof v === 'object') return [{ BIZNO: v.BIZNO ?? v.bizNo ?? key, BIZQTY: v.BIZQTY ?? v.bizQty ?? v.qty ?? null }];
      if (/^\d+$/.test(key)) return [{ BIZNO: key, BIZQTY: v }];
      return [];
    });
  }
  return [];
}

async function emartStock(pluCd, stores) {
  if (!stores.length) return [];
  const u = new URL('/api/stock/v2/stock-search/store', EMART_EVERSE);
  u.searchParams.set('searchPluCode', pluCd);
  u.searchParams.set('bizNoArr', stores.map(s => s.storeCode).join(','));
  const body = await emartReadJson(u.toString(), { headers: emartJsonHeaders(), cf: { cacheTtl: 0, cacheEverything: false } });
  const qtyRows = normalizeQtyRows(body.storeGoodsQty);
  const qty = new Map(qtyRows.map(x => [
    String(x.BIZNO ?? x.bizNo ?? '').trim(),
    (x.BIZQTY ?? x.bizQty ?? x.qty) === '' || (x.BIZQTY ?? x.bizQty ?? x.qty) == null
      ? null : Number(x.BIZQTY ?? x.bizQty ?? x.qty)
  ]));
  return stores.map(s => ({ ...s, bizNo: s.storeCode, bizQty: qty.has(s.storeCode) ? qty.get(s.storeCode) : null }));
}

async function fallbackEmart(url, path, directError) {
  try {
    const out = await relayJson(url.toString(), path);
    if (out.ok && out.body) return json({ ...out.body, source: 'fallback-relay-emart24' });
  } catch {}
  return json({ error: { message: shortError(directError, '이마트24 조회 실패') } }, 502);
}

async function directEmartProducts(url) {
  const keyword = url.searchParams.get('keyword') || '';
  const page = Number(url.searchParams.get('page') || 1);
  const pageSize = Math.min(50, Number(url.searchParams.get('pageSize') || 40));
  if (!keyword.trim()) return json({ error: { message: 'keyword required' } }, 400);
  try {
    const products = await emartProducts(keyword, page, pageSize);
    return json({ ok: true, source: 'direct-emart24', data: { products } });
  } catch (e) {
    return fallbackEmart(url, '/api/emart24/products', e);
  }
}

async function directEmartInventory(url) {
  const keyword = url.searchParams.get('keyword') || '';
  let pluCd = url.searchParams.get('pluCd') || '';
  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
  const storeLimit = Number(url.searchParams.get('storeLimit') || 30);
  try {
    let productCandidates = [];
    if (!pluCd) {
      productCandidates = await emartProducts(keyword, 1, 20);
      const exact = productCandidates.find(p => p.goodsName.replace(/\s+/g,'').toLowerCase() === keyword.replace(/\s+/g,'').toLowerCase());
      pluCd = (exact || productCandidates[0] || {}).pluCd || '';
    }
    if (!pluCd) return json({ error: { message: 'PLU 코드를 찾지 못했습니다.' } }, 404);
    const nearby = await emartStores(lat, lng, storeLimit);
    const stores = await emartStock(pluCd, nearby);
    return json({
      ok: true,
      source: 'direct-emart24',
      data: { keyword, pluCd, productCandidates, nearbyStores: { totalCount: nearby.length, stores: nearby }, stores },
    });
  } catch (e) {
    return fallbackEmart(url, '/api/emart24/inventory', e);
  }
}

async function fallbackSeven(url, path, directError) {
  try {
    const out = await relayJson(url.toString(), path);
    if (out.ok && out.body) return json({ ...out.body, source: 'fallback-relay-seveneleven' });
  } catch {}
  const raw = String(directError?.message || directError || '');
  const msg = /403/.test(raw) ? '세븐일레븐 접근 차단(403)' : /429/.test(raw) ? '세븐일레븐 요청 제한(429)' : '세븐일레븐 조회 실패';
  return json({ error: { message: msg } }, 502);
}

async function directSevenProducts(url) {
  const query = url.searchParams.get('query') || url.searchParams.get('keyword') || '';
  const size = Number(url.searchParams.get('size') || 40);
  if (!query.trim()) return json({ error: { message: 'query required' } }, 400);
  try {
    const products = await sevenProducts(query, size);
    return json({ ok: true, source: 'direct-seveneleven', data: { products } });
  } catch (e) {
    return fallbackSeven(url, '/api/seveneleven/products', e);
  }
}

async function directSevenInventory(url) {
  const keyword = url.searchParams.get('keyword') || '';
  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
  const storeLimit = Number(url.searchParams.get('storeLimit') || 30);
  if (!keyword.trim()) return json({ error: { message: 'keyword required' } }, 400);
  try {
    const result = await sevenInventory(keyword, lat, lng, storeLimit);
    return json({ ok: true, source: 'direct-seveneleven', data: { inventory: { stores: result.stores }, product: result.product, stores: result.stores } });
  } catch (e) {
    return fallbackSeven(url, '/api/seveneleven/inventory', e);
  }
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });
    if (request.method !== 'GET') return json({ error: { message: 'GET only' } }, 405);
    const url = new URL(request.url);

    if (url.pathname === '/' || url.pathname === '/health') {
      return json({ ok: true, service: 'pokemon-stock-radar-backend', version: '0.4.1', frontendReady: true, emart24: 'direct+relay-fallback', seveneleven: 'direct+relay-fallback' });
    }
    if (url.pathname === '/api/emart24/products') return directEmartProducts(url);
    if (url.pathname === '/api/emart24/inventory') return directEmartInventory(url);
    if (url.pathname === '/api/seveneleven/products') return directSevenProducts(url);
    if (url.pathname === '/api/seveneleven/inventory') return directSevenInventory(url);
    if (/^\/api\/(gs25|cu)\//.test(url.pathname)) return relay(request.url, url.pathname);
    return json({ error: { message: 'not found' } }, 404);
  }
};