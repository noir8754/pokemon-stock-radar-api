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

async function proxyToMcp(path, params) {
  const url = new URL(UPSTREAM + path);
  for (const [k, v] of params.entries()) {
    if (v !== '') url.searchParams.set(k, v);
  }
  const r = await fetch(url.toString(), { headers: { 'accept': 'application/json' } });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { ok: r.ok, status: r.status, body };
}

async function handleInventory(url, env) {
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
    note: out.ok ? undefined : '현재는 공개 중계 API 결과를 그대로 전달합니다. 이후 브랜드별 직접 연결을 이 Worker에 붙입니다.'
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
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });
    if (request.method !== 'GET') return json({ error: 'GET only' }, 405);

    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/health') {
      return json({ ok: true, service: 'pokemon-stock-radar-backend', version: '0.1.0' });
    }
    if (url.pathname === '/api/products') return handleProducts(url);
    if (url.pathname === '/api/inventory') return handleInventory(url, env);
    return json({ error: 'not found' }, 404);
  }
};
