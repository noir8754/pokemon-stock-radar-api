import base from './worker.js';

const GS25_BFF = 'https://b2c-bff.woodongs.com';
const GS25_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  'User-Agent': 'Mozilla/5.0 (Linux; Android 15; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0 Mobile Safari/537.36',
  Origin: 'https://woodongs.com',
  Referer: 'https://woodongs.com/',
};

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

function numberOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeGsStore(s) {
  return {
    storeCode: String(s.storeCode || s.shopCode || ''),
    storeName: s.storeName || s.shopName || '',
    address: s.address || s.storeAddress || '',
    phone: s.phone || s.storePhone || '',
    latitude: numberOrNull(s.latitude ?? s.storeYCoordination ?? s.posY),
    longitude: numberOrNull(s.longitude ?? s.storeXCoordination ?? s.posX),
    realStockQuantity: numberOrNull(s.realStockQuantity ?? s.stockQuantity ?? s.stock),
    pickupStockQuantity: numberOrNull(s.pickupStockQuantity),
    deliveryStockQuantity: numberOrNull(s.deliveryStockQuantity),
    searchItemName: s.searchItemName || s.itemName || '',
    searchItemSellPrice: numberOrNull(s.searchItemSellPrice ?? s.sellPrice),
  };
}

async function directGs25Inventory(request, env, ctx) {
  const incoming = new URL(request.url);
  const apiKey = String(env?.GS25_API_KEY || '').trim();

  // 키가 아직 없으면 기존 중계 경로를 그대로 사용한다.
  // 나중에 Cloudflare Secret에 GS25_API_KEY를 넣으면 코드 수정 없이 직접 조회로 전환된다.
  if (!apiKey) return base.fetch(request, env, ctx);

  const itemCode = (incoming.searchParams.get('itemCode') || '').trim();
  const keyword = (incoming.searchParams.get('keyword') || '').trim();
  const lat = Number(incoming.searchParams.get('lat'));
  const lng = Number(incoming.searchParams.get('lng'));
  const storeLimit = Math.max(1, Math.min(100, Number(incoming.searchParams.get('storeLimit') || 50)));

  if (!itemCode) {
    // 상품 코드는 기존 공개 상품검색 결과에서 받아오는 구조다.
    return base.fetch(request, env, ctx);
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return json({ error: { message: 'GS25 재고 조회에 지도 좌표가 필요합니다.' } }, 400);
  }

  const u = new URL('/api/bff/v2/store/stock', GS25_BFF);
  u.searchParams.set('serviceCode', '01');
  u.searchParams.set('itemCode', itemCode);
  u.searchParams.set('realTimeStockYn', 'Y');
  u.searchParams.set('myPositionXCoordination', String(lng));
  u.searchParams.set('myPositionYCoordination', String(lat));
  u.searchParams.set('centerPositionXCoordination', String(lng));
  u.searchParams.set('centerPositionYCoordination', String(lat));
  u.searchParams.set('radiusCondition', '1000');
  u.searchParams.set('pickupStoreYn', 'N');
  u.searchParams.set('isSuperDlvyStoreSelected', 'N');
  u.searchParams.set('isGs25DlvyStoreSelected', 'N');
  u.searchParams.set('pageNumber', '0');
  u.searchParams.set('pageCount', String(storeLimit));

  try {
    const r = await fetch(u.toString(), {
      method: 'GET',
      headers: { ...GS25_HEADERS, 'Api-Key': apiKey },
      cf: { cacheTtl: 0, cacheEverything: false },
      signal: AbortSignal.timeout(15000),
    });

    const text = await r.text();
    let body = null;
    try { body = JSON.parse(text); } catch {}

    if (!r.ok) {
      // 인증 실패면 기존 중계도 한 번 확인한다. 중계가 복구돼 있으면 그대로 사용할 수 있다.
      if (r.status === 401 || r.status === 403) {
        const fallback = await base.fetch(request, env, ctx);
        if (fallback.ok) return fallback;
        return json({
          error: {
            message: 'GS25 인증 연결 필요',
            detail: 'GS25_API_KEY가 만료됐거나 현재 GS25 재고 API 인증과 맞지 않습니다.',
          },
        }, 503);
      }
      return json({ error: { message: `GS25 원본 재고조회 실패 (${r.status})` } }, 502);
    }

    const rawStores = Array.isArray(body?.stores)
      ? body.stores
      : Array.isArray(body?.data?.stores)
        ? body.data.stores
        : [];
    const stores = rawStores.map(normalizeGsStore).filter(s => s.storeCode || s.storeName);

    return json({
      ok: true,
      source: 'direct-gs25-api-key',
      data: {
        keyword,
        itemCode,
        inventory: {
          totalStoreCount: stores.length,
          count: stores.length,
          stores,
        },
      },
    });
  } catch (e) {
    try {
      const fallback = await base.fetch(request, env, ctx);
      if (fallback.ok) return fallback;
    } catch {}
    return json({ error: { message: `GS25 재고조회 실패 · ${String(e?.message || e).slice(0, 120)}` } }, 502);
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });
    const url = new URL(request.url);

    if (url.pathname === '/api/gs25/status') {
      return json({
        ok: true,
        configured: Boolean(String(env?.GS25_API_KEY || '').trim()),
        mode: String(env?.GS25_API_KEY || '').trim() ? 'direct-api-key' : 'relay-only',
      });
    }

    if (url.pathname === '/api/gs25/inventory') {
      return directGs25Inventory(request, env, ctx);
    }

    return base.fetch(request, env, ctx);
  },
};
