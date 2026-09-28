import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/* ---------- formatting ---------- */
export const SYM = { USD: '$', HKD: 'HK$', CNY: '¥', JPY: 'JP¥', EUR: '€' };
export function money(usd, ccy, fx, o = {}) {
  let v = usd / (fx[ccy] || 1);
  const neg = v < -0.5; v = Math.abs(v); let s;
  if (o.c && v >= 1e6) s = (v / 1e6).toFixed(2) + 'M';
  else if (o.c && v >= 1e4) s = (v / 1e3).toFixed(1) + 'K';
  else s = Math.round(v).toLocaleString('en-US');
  return (neg ? '−' : o.s && v >= 0.5 ? '+' : '') + (o.approx ? '≈ ' : '') + (SYM[ccy] || '$') + s;
}
export const pct = (x) => (x >= 0 ? '+' : '−') + Math.abs((x || 0) * 100).toFixed(2) + '%';
export const cls = (x) => (x > 0.5 ? 'up' : x < -0.5 ? 'dn' : '');
export function px(price, ccy, isAlt) {
  if (price == null) return '—';
  if (price > 0 && price < 1 && !isAlt) return (SYM[ccy] || '') + price.toLocaleString('en-US', { maximumSignificantDigits: 4 });
  const d = isAlt ? 0 : price < 10 ? 4 : 2;
  return (SYM[ccy] || '') + price.toLocaleString('en-US', { minimumFractionDigits: isAlt ? 0 : 2, maximumFractionDigits: d });
}
export const qtyFmt = (q, cls) => (+q).toLocaleString('en-US', { maximumFractionDigits: cls === 'crypto' ? 6 : 2 });
export const today = () => new Date().toISOString().slice(0, 10);

/* ---------- valuation (the single place where numbers are computed) ---------- */
export function priceOf(inst, prices, live) {
  if (!inst) return null;
  if (inst.class === 'cash') return 1;
  if (inst.class === 'crypto' && live[inst.symbol]) return live[inst.symbol].price;
  return prices[inst.id]?.price ?? null;
}
export function prevOf(inst, prices, live) {
  if (!inst || inst.class === 'cash') return 1;
  if (inst.class === 'crypto' && live[inst.symbol]?.open) return live[inst.symbol].open;
  return prices[inst.id]?.prev_close ?? priceOf(inst, prices, live);
}
export function holdingValue(h, D) {
  const i = D.inst[h.instrument_id]; if (!i) return 0;
  const p = priceOf(i, D.prices, D.live) ?? +h.avg_cost;
  return +h.qty * p * (D.fx[i.ccy] ?? 1);
}
export function holdingDay(h, D) {
  const i = D.inst[h.instrument_id]; if (!i || i.class === 'cash') return 0;
  const p = priceOf(i, D.prices, D.live), pv = prevOf(i, D.prices, D.live);
  if (p == null || pv == null) return 0;
  return +h.qty * (p - pv) * (D.fx[i.ccy] ?? 1);
}
export function holdingCost(h, D) { const i = D.inst[h.instrument_id]; return i ? +h.qty * +h.avg_cost * (D.fx[i.ccy] ?? 1) : 0; }
export function acctHoldings(D, id) { return D.holdings.filter((h) => h.account_id === id); }
export function nav(D, a) { return acctHoldings(D, a.id).reduce((s, h) => s + holdingValue(h, D), 0); }
export function dayChange(D, a) { return acctHoldings(D, a.id).reduce((s, h) => s + holdingDay(h, D), 0); }
export function rateOf(D, a) { return D.terms[a.id] ?? 0; }
export function profit(D, a) { return nav(D, a) - +a.net_contribution; }
export function carry(D, a) { return a.type === 'lp' ? Math.max(0, profit(D, a)) * rateOf(D, a) : 0; }
export function carryPrev(D, a) { return a.type === 'lp' ? Math.max(0, nav(D, a) - dayChange(D, a) - +a.net_contribution) * rateOf(D, a) : 0; }
export function totals(D) {
  const gp = D.accounts.filter((a) => a.type === 'gp'), lps = D.accounts.filter((a) => a.type === 'lp');
  const own = gp.reduce((s, a) => s + nav(D, a), 0), ownDay = gp.reduce((s, a) => s + dayChange(D, a), 0);
  const cr = lps.reduce((s, a) => s + carry(D, a), 0), crDay = lps.reduce((s, a) => s + carry(D, a) - carryPrev(D, a), 0);
  const lpNav = lps.reduce((s, a) => s + nav(D, a), 0);
  return { own, cr, mine: own + cr, mineDay: ownDay + crDay, lpNav, lpNet: lpNav - cr, aum: own + lpNav, aumDay: D.accounts.reduce((s, a) => s + dayChange(D, a), 0) };
}
export const CLS = { crypto: { n: '加密货币', c: '#0E8C80' }, stock: { n: '股票', c: '#6C7BFF' }, etf: { n: 'ETF', c: '#9AA8FF' }, cash: { n: '现金', c: '#F29E6D' }, alt: { n: '另类资产', c: '#C8B6FF' } };
export function allocation(D, accounts) {
  const m = {}; let tot = 0;
  accounts.forEach((a) => acctHoldings(D, a.id).forEach((h) => { const i = D.inst[h.instrument_id]; if (!i) return; const v = holdingValue(h, D); m[i.class] = (m[i.class] || 0) + v; tot += v; }));
  return { rows: Object.keys(m).sort((a, b) => m[b] - m[a]).map((k) => ({ k, v: m[k], p: tot ? m[k] / tot : 0 })), tot };
}

/* ---------- instrument search (full-market snapshot list, loaded on demand) ---------- */
let LIB = null;
export async function loadLib() {
  if (LIB) return LIB;
  const rows = await (await fetch('/lib.json')).json();
  LIB = rows.map((r, i) => { const [sym, name, cls, ccy, market, alias] = r; const ns = norm(sym).replace(/^0+/, ''); return { sym, name, cls, ccy, market, alias, rank: i, ns, base: ns.replace(/(hk|sh|sz|bj)$/, ''), nl: name.toLowerCase(), al: (alias || '').toLowerCase() }; });
  return LIB;
}
const norm = (x) => x.toLowerCase().replace(/[\s._-]/g, '');
function normQ(q) { let n = norm(q); const m = n.match(/^(hk|sh|sz)(\d+)$/); if (m) n = m[2] + m[1]; return n.replace(/^0+/, ''); }
export function search(lib, q) {
  const raw = q.trim().toLowerCase(); if (!raw) return { list: [], total: 0 };
  const nq = normQ(raw), res = [];
  for (const c of lib) {
    let s = 9;
    if (nq && (c.ns === nq || c.base === nq)) s = 0; else if (nq && c.ns.startsWith(nq)) s = 1; else if (c.nl.startsWith(raw)) s = 2; else if (c.nl.includes(raw)) s = 3; else if (c.al.includes(raw)) s = 4; else if (nq.length >= 3 && c.ns.includes(nq)) s = 5;
    if (s < 9) res.push([s, c]);
  }
  res.sort((a, b) => a[0] - b[0] || a[1].rank - b[1].rank);
  return { list: res.slice(0, 12).map((x) => x[1]), total: res.length };
}
export function guessTicker(q) {
  const t = q.trim().toUpperCase(), s = t.replace(/[\s.]/g, ''); let m;
  if ((m = s.match(/^HK(\d{1,5})$/)) || (m = s.match(/^(\d{1,5})HK$/)) || (m = s.match(/^(\d{1,5})$/))) return { sym: String(+m[1]).padStart(4, '0') + '.HK', ccy: 'HKD', market: 'HK' };
  if ((m = s.match(/^(\d{6})(SH|SZ)?$/)) || (m = s.match(/^(SH|SZ)(\d{6})$/))) { const d = m[1].length === 6 ? m[1] : m[2]; const sx = (m[1].length === 6 ? m[2] : m[1]) || (/^[569]/.test(d) ? 'SH' : 'SZ'); return { sym: d + '.' + sx, ccy: 'CNY', market: 'CN' }; }
  if (/^[A-Z]{1,5}(\.[A-Z])?$/.test(t.replace(/\s/g, ''))) return { sym: t.replace(/\s/g, ''), ccy: 'USD', market: 'US' };
  return null;
}
export const MARKET_N = { HK: '港股', US: '美股', CN: 'A 股', CRYPTO: '加密', CASH: '现金', OTHER: '其他' };
