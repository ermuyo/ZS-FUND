import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from './lib.js';

const EMPTY = { ready: false, isGp: false, settings: null, accounts: [], terms: {}, instList: [], inst: {}, prices: {}, fx: { USD: 1 }, holdings: [], cashflows: [], navDaily: [], live: {} };

export function useData(session) {
  const [D, setD] = useState(EMPTY);
  const liveRef = useRef({});
  const timer = useRef(null);

  const load = useCallback(async () => {
    if (!session) return;
    const { data: isGp } = await supabase.rpc('is_gp');
    const q = (t, sel = '*') => supabase.from(t).select(sel);
    const [acc, terms, inst, px, fx, hold, cf, nd, st] = await Promise.all([
      q('accounts').order('created_at'), isGp ? q('account_terms') : { data: [] }, q('instruments'), q('prices'), q('fx'),
      q('holdings'), q('cashflows').order('date', { ascending: false }), q('nav_daily').order('date'), isGp ? q('settings').maybeSingle() : { data: null },
    ]);
    setD((prev) => ({
      ...prev, ready: true, isGp: !!isGp, settings: st.data,
      accounts: acc.data || [], terms: Object.fromEntries((terms.data || []).map((t) => [t.account_id, +t.carry_rate])),
      instList: inst.data || [], inst: Object.fromEntries((inst.data || []).map((i) => [i.id, i])),
      prices: Object.fromEntries((px.data || []).map((p) => [p.instrument_id, { ...p, price: +p.price, prev_close: p.prev_close == null ? null : +p.prev_close }])),
      fx: Object.fromEntries((fx.data || []).map((f) => [f.ccy, +f.usd_per_unit])),
      holdings: hold.data || [], cashflows: cf.data || [], navDaily: nd.data || [],
    }));
  }, [session]);

  // initial load + realtime: any change reloads (debounced)
  useEffect(() => {
    if (!session) { setD(EMPTY); return; }
    load();
    const ch = supabase.channel('zsfund');
    ['accounts', 'account_terms', 'instruments', 'prices', 'fx', 'holdings', 'cashflows'].forEach((t) =>
      ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => { clearTimeout(timer.current); timer.current = setTimeout(load, 250); }));
    ch.subscribe();
    const iv = setInterval(load, 60000);
    return () => { supabase.removeChannel(ch); clearInterval(iv); };
  }, [session, load]);

  // live crypto prices straight from Coinbase's public feed (real-time, no server needed)
  const cryptoKey = D.instList.filter((i) => i.class === 'crypto' && i.price_mode === 'live').map((i) => i.symbol).sort().join(',');
  useEffect(() => {
    if (!cryptoKey) return;
    let ws, flush, closed = false;
    const connect = () => {
      ws = new WebSocket('wss://ws-feed.exchange.coinbase.com');
      ws.onopen = () => cryptoKey.split(',').forEach((s) => ws.send(JSON.stringify({ type: 'subscribe', product_ids: [s + '-USD'], channels: ['ticker'] })));
      ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === 'ticker' && m.product_id) liveRef.current[m.product_id.replace('-USD', '')] = { price: +m.price, open: +m.open_24h }; };
      ws.onclose = () => { if (!closed) setTimeout(connect, 3000); };
    };
    connect();
    flush = setInterval(() => { if (Object.keys(liveRef.current).length) setD((p) => ({ ...p, live: { ...p.live, ...liveRef.current } })); }, 1500);
    return () => { closed = true; clearInterval(flush); ws && ws.close(); };
  }, [cryptoKey]);

  return [D, load];
}

/* ---------- writes (GP only; RLS enforces it server-side) ---------- */
export async function ensureInstrument(c, mode) {
  const { data: ex } = await supabase.from('instruments').select('*').eq('symbol', c.sym).maybeSingle();
  if (ex) {
    if (mode && ex.class !== 'cash' && ex.price_mode !== mode) await supabase.from('instruments').update({ price_mode: mode }).eq('id', ex.id);
    return ex;
  }
  const row = { symbol: c.sym, name: c.name, class: c.cls, market: c.market, ccy: c.ccy, unit: c.cls === 'crypto' ? c.sym : c.cls === 'etf' ? '份' : c.cls === 'cash' ? '' : c.cls === 'alt' ? '份' : '股', price_mode: c.cls === 'cash' ? 'cash' : c.cls === 'alt' ? 'manual' : mode || 'live' };
  const { data, error } = await supabase.from('instruments').insert(row).select().single();
  if (error) throw error;
  return data;
}
export async function refreshPrices() { try { await supabase.functions.invoke('update-prices'); } catch { /* cron will catch up */ } }
