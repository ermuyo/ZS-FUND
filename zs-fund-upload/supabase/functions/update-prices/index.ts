// ZS FUND · price service
// Called every minute by pg_cron (mode=prices) and once a day (mode=snapshot).
//   crypto : Coinbase Exchange public stats (real-time), OKX as fallback
//   HK / US / A-shares : Yahoo Finance (≈15 min delayed), Tencent as fallback for HK
//   FX     : open.er-api.com
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const UA = { "User-Agent": "Mozilla/5.0 (ZS-FUND price service)" };

type Quote = { price: number; prev?: number; source: string; delayed: boolean };

async function json(url: string) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

async function crypto(sym: string): Promise<Quote | null> {
  if (sym === "USDT" || sym === "USDC") {
    try { const d = await json(`https://api.exchange.coinbase.com/products/${sym}-USD/stats`); return { price: +d.last, prev: +d.open, source: "coinbase", delayed: false }; } catch { return { price: 1, prev: 1, source: "peg", delayed: false }; }
  }
  try { const d = await json(`https://api.exchange.coinbase.com/products/${sym}-USD/stats`); if (+d.last > 0) return { price: +d.last, prev: +d.open, source: "coinbase", delayed: false }; } catch { /* fall through */ }
  try { const d = await json(`https://www.okx.com/api/v5/market/ticker?instId=${sym}-USDT`); const t = d.data?.[0]; if (t && +t.last > 0) return { price: +t.last, prev: +t.open24h, source: "okx", delayed: false }; } catch { /* none */ }
  return null;
}

function yahooSymbol(sym: string) {
  if (sym.endsWith(".SH")) return sym.replace(".SH", ".SS");
  if (/^[A-Z]+\.[A-Z]$/.test(sym)) return sym.replace(".", "-");   // BRK.B -> BRK-B
  return sym;
}
async function yahoo(sym: string): Promise<Quote | null> {
  try {
    const d = await json(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(sym))}?interval=1d&range=5d`);
    const m = d.chart?.result?.[0]?.meta;
    if (m && m.regularMarketPrice > 0) return { price: m.regularMarketPrice, prev: m.chartPreviousClose ?? m.previousClose, source: "yahoo", delayed: true };
  } catch { /* fall through */ }
  return null;
}
async function tencentHK(sym: string): Promise<Quote | null> {
  try {
    const code = "hk" + sym.replace(".HK", "").padStart(5, "0");
    const r = await fetch(`https://qt.gtimg.cn/q=${code}`, { headers: UA });
    const t = await r.text();
    const f = t.split("~");
    if (f.length > 4 && +f[3] > 0) return { price: +f[3], prev: +f[4], source: "tencent", delayed: true };
  } catch { /* none */ }
  return null;
}

async function updateFx() {
  try {
    const d = await json("https://open.er-api.com/v6/latest/USD");
    const rows = ["HKD", "CNY", "JPY", "EUR"].filter((c) => d.rates?.[c]).map((c) => ({ ccy: c, usd_per_unit: 1 / d.rates[c], as_of: new Date().toISOString() }));
    if (rows.length) await sb.from("fx").upsert(rows);
  } catch (e) { console.error("fx", e); }
}

async function updatePrices() {
  const { data: inst, error } = await sb.from("instruments").select("id,symbol,class,market").eq("price_mode", "live");
  if (error) throw error;
  const out: Record<string, unknown>[] = [];
  await Promise.all((inst ?? []).map(async (i) => {
    let q: Quote | null = null;
    if (i.class === "crypto") q = await crypto(i.symbol);
    else { q = await yahoo(i.symbol); if (!q && i.symbol.endsWith(".HK")) q = await tencentHK(i.symbol); }
    if (q) out.push({ instrument_id: i.id, price: q.price, prev_close: q.prev ?? null, source: q.source, delayed: q.delayed, as_of: new Date().toISOString() });
  }));
  if (out.length) await sb.from("prices").upsert(out);
  return out.length;
}

async function snapshot() {
  const [{ data: acc }, { data: hold }, { data: px }, { data: fx }, { data: inst }] = await Promise.all([
    sb.from("accounts").select("id,net_contribution"),
    sb.from("holdings").select("account_id,instrument_id,qty,avg_cost"),
    sb.from("prices").select("instrument_id,price"),
    sb.from("fx").select("ccy,usd_per_unit"),
    sb.from("instruments").select("id,class,ccy"),
  ]);
  const P = Object.fromEntries((px ?? []).map((p) => [p.instrument_id, +p.price]));
  const F = Object.fromEntries((fx ?? []).map((f) => [f.ccy, +f.usd_per_unit]));
  const I = Object.fromEntries((inst ?? []).map((i) => [i.id, i]));
  const date = new Date().toISOString().slice(0, 10);
  const rows = (acc ?? []).map((a) => {
    const nav = (hold ?? []).filter((h) => h.account_id === a.id).reduce((s, h) => {
      const i = I[h.instrument_id]; if (!i) return s;
      const px = i.class === "cash" ? 1 : (P[h.instrument_id] ?? +h.avg_cost);
      return s + +h.qty * px * (F[i.ccy] ?? 1);
    }, 0);
    return { account_id: a.id, date, nav_usd: nav, contribution_usd: +a.net_contribution };
  });
  if (rows.length) await sb.from("nav_daily").upsert(rows);
  return rows.length;
}

Deno.serve(async (req) => {
  const mode = new URL(req.url).searchParams.get("mode") ?? "prices";
  try {
    if (mode === "snapshot") return Response.json({ ok: true, snapshot: await snapshot() });
    await updateFx();
    return Response.json({ ok: true, updated: await updatePrices() });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
});
