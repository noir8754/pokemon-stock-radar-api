const UPSTREAM = 'https://mcp.aka.page';

function cors(origin = '*') {
  return {
    'Access-Control-Allow-Origin': origin,
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

async function proxyToMcp(path, params) {
  const url = new URL(UPSTREAM + path);
  for (const [k, v] of params.entries()) {
    if (v !== '') url.searchParams.set(k, v);
  }
  const r = await fetch(url.toString(), { headers: { accept: 'application/json' } });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { ok: r.ok, status: r.status, body };
}

async function handleInventory(url) {
  const brand = (url.searchParams.get('brand') || '').toUpperCase();
  const keyword = url.searchParams.get('keyword') || '';
  const lat = url.searchParams.get('lat') || '';
  const lng = url.searchParams.get('lng') || '';
  const itemCode = url.searchParams.get('itemCode') || '';
  const pluCd = url.searchParams.get('pluCd') || '';
  const storeLimit = url.searchParams.get('storeLimit') || '50';

  if (!brand) return json({ error: 'brand is required' }, 400);
  if (!keyword && !itemCode && !pluCd) return json({ error: 'keyword or product code is required' }, 400);

  let path = '';
  const q = new URLSearchParams();

  if (brand === 'CU') {
    path = '/api/cu/inventory';
    q.set('keyword', keyword);
    q.set('lat', lat);
    q.set('lng', lng);
    q.set('size', '40');
    q.set('storeLimit', storeLimit);
  } else if (brand === 'GS25') {
    path = '/api/gs25/inventory';
    if (keyword) q.set('keyword', keyword);
    if (itemCode) q.set('itemCode', itemCode);
    q.set('lat', lat);
    q.set('lng', lng);
    q.set('storeLimit', storeLimit);
    q.set('timeoutMs', '20000');
  } else if (brand === 'EMART24') {
    path = '/api/emart24/inventory';
    if (keyword) q.set('keyword', keyword);
    if (pluCd) q.set('pluCd', pluCd);
    q.set('lat', lat);
    q.set('lng', lng);
    q.set('storeLimit', storeLimit);
    q.set('timeoutMs', '20000');
  } else if (brand === '7ELEVEN') {
    path = '/api/seveneleven/inventory';
    q.set('keyword', keyword);
    q.set('lat', lat);
    q.set('lng', lng);
    q.set('storeLimit', storeLimit);
    q.set('timeoutMs', '20000');
  } else {
    return json({ error: 'unsupported brand' }, 400);
  }

  const out = await proxyToMcp(path, q);
  return json({
    brand,
    mode: 'relay',
    upstreamStatus: out.status,
    ok: out.ok,
    data: out.body,
    note: out.ok ? undefined : '현재 공개 중계 API 상태를 전달했습니다.'
  }, out.ok ? 200 : 502);
}

async function handleProducts(url) {
  const brand = (url.searchParams.get('brand') || '').toUpperCase();
  const keyword = url.searchParams.get('keyword') || '';
  if (!brand || !keyword) return json({ error: 'brand and keyword are required' }, 400);

  let path = '';
  const q = new URLSearchParams();
  if (brand === 'GS25') { path = '/api/gs25/products'; q.set('keyword', keyword); q.set('limit', '50'); }
  else if (brand === 'EMART24') { path = '/api/emart24/products'; q.set('keyword', keyword); q.set('page', '1'); q.set('pageSize', '50'); }
  else if (brand === 'CU') { path = '/api/cu/inventory'; q.set('keyword', keyword); q.set('storeCheck', 'false'); q.set('size', '50'); }
  else if (brand === '7ELEVEN') { path = '/api/seveneleven/products'; q.set('query', keyword); q.set('page', '1'); q.set('size', '50'); }
  else return json({ error: 'unsupported brand' }, 400);

  const out = await proxyToMcp(path, q);
  return json({ brand, upstreamStatus: out.status, ok: out.ok, data: out.body }, out.ok ? 200 : 502);
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });
    if (request.method !== 'GET') return json({ error: 'GET only' }, 405);

    const url = new URL(request.url);

    if (url.pathname === '/' || url.pathname === '/health') {
      return json({
        ok: true,
        service: 'pokemon-stock-radar-backend',
        version: '0.2.0',
        upstream: UPSTREAM,
        frontendReady: true
      });
    }

    if (url.pathname === '/api/products') return handleProducts(url);
    if (url.pathname === '/api/inventory') return handleInventory(url);

    // Frontend compatibility: keep the same paths it already uses,
    // but route every request through our own Cloudflare Worker first.
    if (/^\/api\/(gs25|emart24|cu|seveneleven)\//.test(url.pathname)) {
      return relay(request.url, url.pathname);
    }

    return json({ error: 'not found' }, 404);
  }
};
