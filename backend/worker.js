const UPSTREAM = 'https://mcp.aka.page';
const EMART_WEB = 'https://emart24.co.kr';
const EMART_EVERSE = 'https://everse.emart24.co.kr';

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

async function readJson(url, init = {}) {
  const r = await fetch(url, init);
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!r.ok) {
    const msg = body?.error?.message || body?.message || text.slice(0, 180) || `HTTP ${r.status}`;
    throw new Error(`HTTP ${r.status} · ${msg}`);
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

function emartJsonHeaders() {
  return {
    Accept: 'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
    Referer: 'https://emart24.co.kr/',
  };
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
    const area1 = normalizeArea1(a.city || a.state || a.province || '');
    const area2 = a.borough || a.city_district || a.county || a.town || '';
    return { area1, area2 };
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
  const body = await readJson(`${EMART_EVERSE}/stock/stock/search`, {
    method: 'POST',
    headers: {
      ...emartJsonHeaders(),
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Referer: `${EMART_EVERSE}/stock`,
    },
    body: form.toString(),
  });
  return (body.productList || []).map(x => ({
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
        const body = await readJson(u.toString(), { headers: emartJsonHeaders() });
        const batch = (body.data || []).map(emartStore).filter(s => s.storeCode);
        found.push(...batch);
        if (!batch.length || found.length >= 120) break;
      }
      if (found.length) { stores = found; break; }
    } catch (e) { lastErr = e.message || String(e); }
  }
  if (!stores.length && lastErr) throw new Error(lastErr);

  const uniq = new Map();
  for (const s of stores) if (!uniq.has(s.storeCode)) uniq.set(s.storeCode, s);
  const list = [...uniq.values()].map(s => ({
    ...s,
    distanceM: s.latitude && s.longitude && Number.isFinite(lat) && Number.isFinite(lng)
      ? distanceM(lat, lng, s.latitude, s.longitude) : null,
  })).sort((a,b) => (a.distanceM ?? 1e12) - (b.distanceM ?? 1e12));
  return list.slice(0, Math.max(1, Math.min(60, storeLimit)));
}

async function emartStock(pluCd, stores) {
  if (!stores.length) return [];
  const u = new URL('/api/stock/v2/stock-search/store', EMART_EVERSE);
  u.searchParams.set('searchPluCode', pluCd);
  u.searchParams.set('bizNoArr', stores.map(s => s.storeCode).join(','));
  const body = await readJson(u.toString(), { headers: { ...emartJsonHeaders(), Referer: `${EMART_EVERSE}/stock` } });
  const qty = new Map((body.storeGoodsQty || []).map(x => [String(x.BIZNO || ''), x.BIZQTY === '' || x.BIZQTY == null ? null : Number(x.BIZQTY)]));
  return stores.map(s => ({ ...s, bizNo: s.storeCode, bizQty: qty.has(s.storeCode) ? qty.get(s.storeCode) : null }));
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
    return json({ error: { message: `이마트24 직접 상품조회 실패: ${e.message || e}` } }, 502);
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
      data: {
        keyword,
        pluCd,
        productCandidates,
        nearbyStores: { totalCount: nearby.length, stores: nearby },
        stores,
      },
    });
  } catch (e) {
    return json({ error: { message: `이마트24 직접 재고조회 실패: ${e.message || e}` } }, 502);
  }
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });
    if (request.method !== 'GET') return json({ error: { message: 'GET only' } }, 405);
    const url = new URL(request.url);

    if (url.pathname === '/' || url.pathname === '/health') {
      return json({ ok: true, service: 'pokemon-stock-radar-backend', version: '0.3.0', frontendReady: true, emart24: 'direct' });
    }

    if (url.pathname === '/api/emart24/products') return directEmartProducts(url);
    if (url.pathname === '/api/emart24/inventory') return directEmartInventory(url);

    if (/^\/api\/(gs25|cu|seveneleven)\//.test(url.pathname)) {
      return relay(request.url, url.pathname);
    }

    return json({ error: { message: 'not found' } }, 404);
  }
};
