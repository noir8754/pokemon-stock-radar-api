const BASE='https://new.7-elevenapp.co.kr';
const HEADERS={Accept:'application/json, text/plain, */*','Content-Type':'application/json','User-Agent':'Mozilla/5.0 (Linux; Android 15)'};
const PRODUCT_CACHE_TTL=86400;
const INVENTORY_CACHE_TTL=21600;

async function readJson(url,init={}){
  const r=await fetch(url,{...init,cf:{cacheTtl:0,cacheEverything:false}});
  const text=await r.text();
  let body; try{body=JSON.parse(text)}catch{body={raw:text}}
  if(!r.ok){const e=new Error(`HTTP ${r.status}`);e.status=r.status;throw e}
  return body;
}
function num(v){const n=Number(v);return Number.isFinite(n)?n:0}
function str(v){return typeof v==='string'?v:''}
function rawProduct(x){return x&&typeof x==='object'&&x.field&&typeof x.field==='object'?x.field:(x||{})}
function product(x){x=rawProduct(x);return{productNo:str(x.prdNo),itemCode:str(x.itemCd),itemName:str(x.itemOnm),salePrice:num(x.onlinePrice),originalPrice:num(x.onlineCost),imageUrl:str(x.repImgUrl)}}
function store(x){x=rawProduct(x);return{storeCode:str(x.storeCode||x.storeCd||x.strCd||x.storCd||x.shopCd),storeName:str(x.storeName||x.storeNm||x.strNm||x.storNm||x.shopNm),address:str(x.address||x.addr||x.roadAddr||x.shopAddr)||`${str(x.addr1)} ${str(x.addr2)}`.trim(),latitude:num(x.latitude||x.storeLat||x.lat||x.yPos||x.y||x.yCoord),longitude:num(x.longitude||x.storeLon||x.lng||x.xPos||x.x||x.xCoord)}}
function docs(data){const cols=data?.SearchQueryResult?.Collection;if(!Array.isArray(cols))return Array.isArray(data?.content)?data.content:[];return cols.flatMap(c=>Array.isArray(c?.Documentset?.Document)?c.Documentset.Document:[])}
function cacheRequest(kind,key){return new Request(`https://pokemon-stock-radar-cache.invalid/seven/${kind}/${encodeURIComponent(key)}`)}
async function cacheGet(kind,key){try{const r=await caches.default.match(cacheRequest(kind,key));if(!r)return null;const v=await r.json();return{...v,_cacheUsed:true}}catch{return null}}
async function cachePut(kind,key,value,ttl){try{const r=new Response(JSON.stringify(value),{headers:{'content-type':'application/json','cache-control':`public, max-age=${ttl}`}});await caches.default.put(cacheRequest(kind,key),r)}catch{}}

async function liveSevenProducts(query,size=40){
  const body=await readJson(`${BASE}/api/v1/open/search/goods`,{method:'POST',headers:HEADERS,body:JSON.stringify({collection:'goods',query,sort:'quantity/desc,itemOnm/asc',startCount:0,listCount:100})});
  const rows=docs(body.data||body).map(product).filter(p=>p.itemCode||p.itemName);
  const uniq=[];const seen=new Set();for(const p of rows){const k=p.itemCode||p.itemName;if(seen.has(k))continue;seen.add(k);uniq.push(p)}
  return uniq.slice(0,Math.max(1,Math.min(100,size)));
}
export async function sevenProducts(query,size=40){
  const key=`${String(query).trim().toLowerCase()}|${Math.max(1,Math.min(100,size))}`;
  try{
    const products=await liveSevenProducts(query,size);
    await cachePut('products',key,{products,checkedAt:Date.now()},PRODUCT_CACHE_TTL);
    return products;
  }catch(e){
    const cached=await cacheGet('products',key);
    if(cached?.products?.length)return cached.products;
    throw e;
  }
}
async function area(lat,lng){
  try{const u=new URL('https://nominatim.openstreetmap.org/reverse');u.searchParams.set('format','jsonv2');u.searchParams.set('lat',lat);u.searchParams.set('lon',lng);u.searchParams.set('zoom','14');u.searchParams.set('addressdetails','1');const d=await readJson(u,{headers:{Accept:'application/json','User-Agent':'pokemon-stock-radar/1.0'}});const a=d.address||{};return a.suburb||a.borough||a.city_district||a.town||a.county||a.city||''}catch{return''}
}
async function sevenStores(lat,lng,limit=30){
  const keyword=await area(lat,lng);
  if(!keyword)return[];
  const body=await readJson(`${BASE}/api/v1/open/search/store`,{method:'POST',headers:HEADERS,body:JSON.stringify({collection:'store',query:String(keyword).replace(/\s+/g,''),sort:'Date/desc',listCount:100})});
  return docs(body.data||body).map(store).filter(s=>s.storeCode).map(s=>({...s,distanceM:distance(lat,lng,s.latitude,s.longitude)})).sort((a,b)=>a.distanceM-b.distanceM).slice(0,Math.max(1,Math.min(50,limit)));
}
function distance(a,b,c,d){if(![a,b,c,d].every(Number.isFinite))return 1e12;const R=6371000,rad=x=>x*Math.PI/180,dl=rad(c-a),dn=rad(d-b),q=Math.sin(dl/2)**2+Math.cos(rad(a))*Math.cos(rad(c))*Math.sin(dn/2)**2;return Math.round(R*2*Math.atan2(Math.sqrt(q),Math.sqrt(1-q)))}
async function meta(code){const b=await readJson(`${BASE}/api/v1/open/product/search/stock?itemCd=${encodeURIComponent(code)}`,{headers:{Accept:HEADERS.Accept,'User-Agent':HEADERS['User-Agent']}});return{itemCode:str(b.itemCd),smCd:str(b.smCd),stokMngCd:str(b.stokMngCd),stokMngQty:num(b.stokMngQty),stockApplicationRate:String(b.stockApplicationRate??'')}}
async function stockOne(m,s){const payload={smCd:m.smCd,stokMngCd:m.stokMngCd,stokMngQty:m.stokMngQty,stockApplicationRate:m.stockApplicationRate,storeList:[s.storeCode]};const b=await readJson(`${BASE}/api/v1/open/real-stock/multi/01/stocks`,{method:'POST',headers:HEADERS,body:JSON.stringify(payload)});const list=Array.isArray(b?.data?.storeList)?b.data.storeList:[];const row=list.find(x=>String(x.storeCd||'')===s.storeCode)||list[0];const q=row?Number(row.stock??row.stokMngQty):-1;return{...s,stockQuantity:Number.isFinite(q)?q:-1}}
async function liveSevenInventory(keyword,lat,lng,storeLimit=30){
  const products=await sevenProducts(keyword,20);const p=products[0];if(!p)return{product:null,stores:[],checkedAt:Date.now()};
  const stores=await sevenStores(lat,lng,storeLimit);if(!stores.length)return{product:p,stores:[],checkedAt:Date.now()};
  const m=await meta(p.itemCode);if(!m.itemCode||!m.smCd||!m.stokMngCd)return{product:p,stores:stores.map(s=>({...s,stockQuantity:-1})),checkedAt:Date.now()};
  const out=[];for(const s of stores){try{out.push(await stockOne(m,s))}catch(e){if(e?.status===429)break;out.push({...s,stockQuantity:-1})}}
  return{product:p,stores:out,checkedAt:Date.now()};
}
export async function sevenInventory(keyword,lat,lng,storeLimit=30){
  const latKey=Number.isFinite(lat)?lat.toFixed(3):'x';
  const lngKey=Number.isFinite(lng)?lng.toFixed(3):'x';
  const key=`${String(keyword).trim().toLowerCase()}|${latKey}|${lngKey}|${Math.max(1,Math.min(50,storeLimit))}`;
  try{
    const result=await liveSevenInventory(keyword,lat,lng,storeLimit);
    await cachePut('inventory',key,result,INVENTORY_CACHE_TTL);
    return{...result,cacheUsed:false};
  }catch(e){
    const cached=await cacheGet('inventory',key);
    if(cached)return{product:cached.product||null,stores:Array.isArray(cached.stores)?cached.stores:[],checkedAt:cached.checkedAt||null,cacheUsed:true};
    throw e;
  }
}
