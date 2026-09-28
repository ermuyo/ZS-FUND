import { useMemo } from 'react';
import { supabase } from './lib.js';
import * as L from './lib.js';

const AV = ['#D8F3EE|#0B7A6F', '#E6E1FF|#5B45C9', '#FFE4D4|#B8582A', '#E3E9F2|#4A5A72', '#FFE3EC|#D63C78'];
export function Avatar({ a, i = 0 }) {
  if (a.type === 'gp') return <span className="av" style={{ background: '#10213A', color: '#fff' }}>H</span>;
  const [bg, fg] = AV[i % AV.length].split('|');
  return <span className="av" style={{ background: bg, color: fg }}>{(a.name || '?').trim()[0]}</span>;
}
const M = (usd, ctx, o) => L.money(usd, ctx.ccy, ctx.D.fx, o);

/* ---------- chart ---------- */
export function LineChart({ series, ccy, fx, height = 190 }) {
  if (!series.length || series[0].v.length < 2) return <div className="empty">每天收盘后自动记录一次，明天起就有走势图了。</div>;
  const all = series.flatMap((s) => s.v); let mn = Math.min(...all), mx = Math.max(...all); const pad = (mx - mn) * 0.1 || mx * 0.01 || 1; mn -= pad; mx += pad;
  const N = series[0].v.length, W = 600, H = 200;
  const X = (i) => (i / (N - 1)) * W, Y = (v) => H - ((v - mn) / (mx - mn)) * H;
  return (
    <div style={{ position: 'relative' }}>
      <svg className="chart" style={{ height }} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="lg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#0E8C80" stopOpacity=".28" /><stop offset="1" stopColor="#0E8C80" stopOpacity="0" /></linearGradient></defs>
        {series.map((s, k) => { const d = s.v.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(''); return (<g key={k}>{s.fill && <path d={`${d}L${W} ${H}L0 ${H}Z`} fill="url(#lg)" />}<path d={d} fill="none" stroke={s.color} strokeWidth={s.w || 2.5} strokeDasharray={s.dash ? '5 4' : undefined} vectorEffect="non-scaling-stroke" strokeLinejoin="round" /></g>); })}
      </svg>
      <span className="small" style={{ position: 'absolute', left: 0, top: 0 }}>{L.money(mx, ccy, fx, { c: 1 })}</span>
      <span className="small" style={{ position: 'absolute', left: 0, bottom: 0 }}>{L.money(mn, ccy, fx, { c: 1 })}</span>
    </div>
  );
}
function navSeries(D, accounts, f) {
  const dates = [...new Set(D.navDaily.map((n) => n.date))].sort();
  return dates.map((d) => accounts.reduce((s, a) => { const r = D.navDaily.find((n) => n.account_id === a.id && n.date === d); return s + (r ? f(r, a) : 0); }, 0));
}

/* ---------- pieces ---------- */
function Alloc({ D, accounts, ctx }) {
  const { rows, tot } = L.allocation(D, accounts);
  if (!tot) return <div className="empty">还没有持仓</div>;
  return <div className="alloc">{rows.map((r) => (<div key={r.k} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{L.CLS[r.k].n}</span><b>{M(r.v, ctx, { c: 1 })} <span className="small">· {(r.p * 100).toFixed(1)}%</span></b></div><div className="track"><div style={{ width: (r.p * 100).toFixed(2) + '%', background: L.CLS[r.k].c }} /></div></div>))}</div>;
}
function srcChip(i, D, canEdit, ctx) {
  if (i.class === 'cash') return null;
  const p = D.prices[i.id];
  if (i.price_mode === 'live') {
    const stale = p && Date.now() - new Date(p.as_of).getTime() > 30 * 60000 && i.class === 'crypto';
    if (!p && !D.live[i.symbol]) return <span className="chip warn">等待行情</span>;
    return i.class === 'crypto' ? <span className="chip teal live"><i />实时</span> : <span className="chip teal" title={p?.source}>{stale ? '价格可能过时' : '延迟 15 分'}</span>;
  }
  const d = p ? p.as_of.slice(0, 10) : '';
  const stale = p && Date.now() - new Date(p.as_of).getTime() > 180 * 86400000;
  const txt = (i.class === 'alt' ? '手动估值' : '手动') + (d ? ' · ' + d : '');
  return canEdit ? <button className={'chip ' + (stale ? 'warn' : '')} onClick={(e) => { e.stopPropagation(); ctx.open({ k: 'val', inst: i }); }}>{txt} ✎</button> : <span className={'chip ' + (stale ? 'warn' : '')}>{txt}</span>;
}
export function HoldList({ ctx, items, showAcct, canEdit }) {
  const { D } = ctx;
  if (!items.length) return <div className="empty">还没有持仓，点「添加资产」开始。</div>;
  const sorted = [...items].sort((a, b) => L.holdingValue(b.h, D) - L.holdingValue(a.h, D));
  return (
    <div className="rows">
      {sorted.map(({ h, a }) => {
        const i = D.inst[h.instrument_id]; if (!i) return null;
        const v = L.holdingValue(h, D), pnl = v - L.holdingCost(h, D), cost = L.holdingCost(h, D);
        const p = L.priceOf(i, D.prices, D.live), pv = L.prevOf(i, D.prices, D.live), dp = p && pv ? (p - pv) / pv : 0;
        const Row = canEdit ? 'button' : 'div';
        return (
          <Row key={h.id} className="row" onClick={canEdit ? () => ctx.open({ k: 'edit', h, a }) : undefined}>
            <div className="grow"><div className="nm">{i.name}</div><div className="sub"><span>{i.symbol}</span>{i.market && i.market !== 'CASH' && <span>{L.MARKET_N[i.market] || i.market}</span>}{srcChip(i, D, canEdit, ctx)}{showAcct && <span className="chip">{a.name}</span>}</div></div>
            <div className="r w"><div className="v">{i.class === 'cash' ? (i.ccy === 'USD' ? '—' : `1 ${i.ccy} = $${(D.fx[i.ccy] || 0).toFixed(4)}`) : L.px(p, i.ccy, i.class === 'alt')}</div><div className={'small ' + (i.class === 'cash' || i.price_mode !== 'live' ? '' : L.cls(dp * 1e6))}>{i.class === 'cash' ? '汇率' : i.price_mode !== 'live' ? '' : L.pct(dp)}</div></div>
            <div className="r"><div className="v">{M(v, ctx)}</div><div className="small">{L.qtyFmt(h.qty, i.class)} {i.unit}</div></div>
            <div className="r w"><div className={'v ' + (i.class === 'cash' ? '' : L.cls(pnl))}>{i.class === 'cash' ? '—' : M(pnl, ctx, { s: 1 })}</div><div className="small">{i.class === 'cash' || !cost ? '' : L.pct(pnl / cost)}</div></div>
          </Row>
        );
      })}
    </div>
  );
}
function CarryPanel({ ctx, a }) {
  const { D } = ctx; const n = L.nav(D, a), p = L.profit(D, a), c = L.carry(D, a), rate = L.rateOf(D, a);
  const PRESETS = [0, 10, 15, 20, 25, 30];
  const setRate = async (r) => { await supabase.from('account_terms').upsert({ account_id: a.id, carry_rate: r / 100 }); ctx.toast(`${a.name} 的 carry 比例已设为 ${r}%`); };
  return (
    <section className="card">
      <div className="card-h"><h3>Carry</h3><span className="chip violet">计入我的总资产 · 不从 LP 扣</span></div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}><span className="small">比例</span><div className="seg">{PRESETS.map((r) => <button key={r} aria-pressed={Math.round(rate * 1000) / 10 === r} onClick={() => setRate(r)}>{r}%</button>)}</div>
        <input aria-label="自定义比例" type="number" min="0" max="100" step="0.5" placeholder="自定义 %" style={{ width: 90, border: '1px solid rgba(16,33,58,.12)', borderRadius: 10, padding: '5px 8px', background: '#fff' }} onKeyDown={(e) => { if (e.key === 'Enter' && e.target.value !== '') { setRate(+e.target.value); e.target.value = ''; } }} /></div>
      <div className="calc">
        <div className="cl"><span>净投入本金</span><b>{M(+a.net_contribution, ctx)}</b></div>
        <div className="cl"><span>当前账户净值</span><b>{M(n, ctx)}</b></div>
        <div className="cl"><span>累计利润</span><b className={L.cls(p)}>{M(p, ctx, { s: 1 })}</b></div>
        <div className="cl"><span>× carry 比例</span><b>{(rate * 100).toFixed(1).replace(/\.0$/, '')}%</b></div>
        <div className="cl tot"><span>= carry（归你）</span><b style={{ color: 'var(--violet)' }}>{M(c, ctx)}</b></div>
        <div className="cl"><span>LP 扣 carry 后约</span><b style={{ color: 'var(--ink2)' }}>{M(n - c, ctx, { approx: 1 })}</b></div>
      </div>
      <p className="note">{rate === 0 ? '比例为 0%：这个账户只代管，不产生 carry。' : p <= 0 ? '账户目前亏损，carry 为 0。' : 'carry 计入你的总资产，但不会从 LP 账户扣钱。LP 登录后看到的是全额净值，看不到这部分。'}</p>
    </section>
  );
}
function Flows({ ctx, a, canEdit }) {
  const { D } = ctx; const f = D.cashflows.filter((c) => c.account_id === a.id);
  const K = { deposit: '入金', withdrawal: '出金', transfer_in: '资产转入' };
  return (
    <section className="card"><div className="card-h"><h3>资金流水</h3>{canEdit && <div className="btns"><button className="btn" onClick={() => ctx.open({ k: 'flow', a, t: 'deposit' })}>记录入金</button><button className="btn" onClick={() => ctx.open({ k: 'flow', a, t: 'withdrawal' })}>记录出金</button></div>}</div>
      {f.length ? <div className="rows">{f.map((c) => <div key={c.id} className="row"><span className="small" style={{ width: 92 }}>{c.date}</span><span className="grow">{K[c.kind]}{c.note ? <span className="small"> · {c.note}</span> : ''}</span><span className="v r">{M(c.kind === 'withdrawal' ? -c.amount_usd : +c.amount_usd, ctx, { s: 1 })}</span>{canEdit && <button className="back" aria-label="删除" onClick={async () => { if (!confirmDel(ctx)) return; await supabase.from('cashflows').delete().eq('id', c.id); ctx.toast('已删除'); }}>删除</button>}</div>)}</div> : <div className="empty">还没有记录。入金会计入净投入本金，不算利润。</div>}
    </section>
  );
}
let lastDel = 0; function confirmDel(ctx) { const n = Date.now(); if (n - lastDel < 4000) { lastDel = 0; return true; } lastDel = n; ctx.toast('再点一次确认删除'); return false; }

/* ---------- GP views ---------- */
export function Overview(ctx) {
  const { D } = ctx; const t = L.totals(D); const lps = D.accounts.filter((a) => a.type === 'lp'), gps = D.accounts.filter((a) => a.type === 'gp');
  const aumS = useMemo(() => navSeries(D, D.accounts, (r) => +r.nav_usd), [D]);
  const mineS = useMemo(() => navSeries(D, D.accounts, (r, a) => a.type === 'gp' ? +r.nav_usd : Math.max(0, +r.nav_usd - +r.contribution_usd) * L.rateOf(D, a)), [D]);
  const w = (x) => (t.aum ? (x / t.aum) * 100 : 0).toFixed(2) + '%';
  return (<>
    <div className="grid-hero">
      <section className="card span2"><div className="muted">我的总资产 · 含 carry</div>
        <div className="big">{M(t.mine, ctx)}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}><span className={'chip ' + (t.mineDay >= 0 ? 'teal' : 'warn')}>{M(t.mineDay, ctx, { s: 1 })} · {L.pct(t.mine - t.mineDay ? t.mineDay / (t.mine - t.mineDay) : 0)}</span><span className="small">今日</span></div>
        <div style={{ display: 'flex', gap: 26, marginTop: 18, fontSize: 13 }} className="muted"><span>自有资金 <b style={{ color: 'var(--ink)' }}>{M(t.own, ctx)}</b></span><span>carry <b style={{ color: 'var(--violet)' }}>+{M(t.cr, ctx)}</b> <span className="small">在 {lps.filter((a) => L.carry(D, a) > 0.5).length} 个 LP 账户里</span></span></div>
      </section>
      <section className="card dark"><div style={{ color: 'var(--mint)', fontSize: 14 }}>管理总规模 AUM</div><div className="big2">{M(t.aum, ctx, { c: 1 })}</div>
        <div className="bar" style={{ marginTop: 'auto', paddingTop: 12 }}><span style={{ width: w(t.own), background: '#7EE0D2' }} /><span style={{ width: w(t.cr), background: '#C8B6FF' }} /><span style={{ flexGrow: 1, background: 'rgba(255,255,255,.35)' }} /></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#AAB6CC', marginTop: 8 }}><span>自有 {t.aum ? (t.own / t.aum * 100).toFixed(0) : 0}%</span><span>carry {t.aum ? (t.cr / t.aum * 100).toFixed(0) : 0}%</span><span>LP 扣后 {t.aum ? (t.lpNet / t.aum * 100).toFixed(0) : 0}%</span></div></section>
      <section className="card"><div className="muted" style={{ marginBottom: 10 }}>资产配置</div><Alloc D={D} accounts={D.accounts} ctx={ctx} /></section>
    </div>
    <div className="two">
      <section className="card"><div className="card-h"><h3>净值走势</h3><span className="small">AUM（实线）· 我的总资产（虚线）</span></div><LineChart series={[{ v: aumS, color: '#0E8C80', fill: 1 }, { v: mineS, color: '#7C4DDB', w: 2, dash: 1 }]} ccy={ctx.ccy} fx={D.fx} /></section>
      <section className="card"><div className="card-h"><h3>账户</h3><button className="btn" onClick={() => ctx.open({ k: 'acct' })}>＋ 新建 LP 账户</button></div>
        <div className="rows">{[...gps, ...lps].map((a, i) => <button key={a.id} className="row" onClick={() => ctx.go('acct', a.id)}><Avatar a={a} i={i - 1} /><div className="grow"><div className="nm">{a.name}</div><div className="sub">{a.type === 'gp' ? 'GP 自有' : `LP · carry ${(L.rateOf(D, a) * 100).toFixed(0)}%`}</div></div><div className="r"><div className="v">{M(L.nav(D, a), ctx)}</div><div className={'small ' + L.cls(L.dayChange(D, a))}>{M(L.dayChange(D, a), ctx, { s: 1 })}</div></div>{a.type === 'lp' && <div className="r w" style={{ width: 90, color: 'var(--violet)', fontSize: 13 }}>{M(L.carry(D, a), ctx)}</div>}</button>)}</div></section>
    </div>
  </>);
}
export function Accounts(ctx) {
  const { D } = ctx;
  return (<>
    <div className="card-h"><h3 style={{ fontSize: 20 }}>{D.accounts.length} 个账户</h3><button className="btn pri" onClick={() => ctx.open({ k: 'acct' })}>＋ 新建 LP 账户</button></div>
    <div className="grid-hero">{D.accounts.map((a, i) => { const n = L.nav(D, a), d = L.dayChange(D, a); return (
      <button key={a.id} className="card" style={{ textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6 }} onClick={() => ctx.go('acct', a.id)}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><Avatar a={a} i={i - 1} /><span className={'chip ' + (a.type === 'gp' ? '' : 'violet')}>{a.type === 'gp' ? 'GP 自有' : `carry ${(L.rateOf(D, a) * 100).toFixed(0)}%`}</span></div>
        <div style={{ fontWeight: 600, fontSize: 16, marginTop: 6 }}>{a.name}</div>
        <div className="big2" style={{ fontSize: 24 }}>{M(n, ctx)}</div>
        <div className={'small ' + L.cls(d)}>{M(d, ctx, { s: 1 })} 今日</div>
        <div className="small" style={{ marginTop: 'auto' }}>{a.type === 'lp' ? (a.lp_email || '未设置登录邮箱') : '只有你能看到'}</div>
      </button>); })}</div>
  </>);
}
export function AccountDetail(ctx) {
  const { D, id } = ctx; const a = D.accounts.find((x) => x.id === id); if (!a) return <Accounts {...ctx} />;
  const items = L.acctHoldings(D, a.id).map((h) => ({ h, a })); const n = L.nav(D, a), d = L.dayChange(D, a), p = L.profit(D, a);
  const own = D.accounts.filter((x) => x.type === 'gp');
  return (<>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button className="back" onClick={() => ctx.go(ctx.view.from || 'home')}>← 返回</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}><h2 style={{ margin: 0, fontSize: 26 }}>{a.name}</h2>{a.type === 'lp' ? <><span className="chip violet">LP · carry {(L.rateOf(D, a) * 100).toFixed(0)}%</span><span className="chip">{a.lp_email || '未设置登录邮箱'}</span></> : <span className="chip">GP 自有资金 · LP 不可见</span>}</div>
      <div className="btns"><button className="btn pri" onClick={() => ctx.open({ k: 'add', acct: a.id })}>＋ 添加资产</button>{a.type === 'lp' && <><button className="btn" onClick={() => ctx.open({ k: 'flow', a, t: 'deposit' })}>记录入金</button><button className="btn" onClick={() => ctx.open({ k: 'flow', a, t: 'withdrawal' })}>记录出金</button><button className="btn" onClick={() => ctx.open({ k: 'acct', a })}>编辑账户</button></>}</div>
    </div>
    <div className="kpis">
      <div className="kpi"><span className="small">{a.type === 'lp' ? '账户净值（LP 看到的数）' : '账户净值'}</span><b>{M(n, ctx)}</b><span className={'small ' + L.cls(d)}>{M(d, ctx, { s: 1 })} 今日</span></div>
      {a.type === 'lp' ? <>
        <div className="kpi"><span className="small">净投入本金</span><b>{M(+a.net_contribution, ctx)}</b><span className="small">自 {a.since}</span></div>
        <div className="kpi"><span className="small">累计利润</span><b className={L.cls(p)}>{M(p, ctx, { s: 1 })}</b><span className="small">{+a.net_contribution ? L.pct(p / +a.net_contribution) : ''}</span></div>
        <div className="kpi"><span className="small">carry</span><b style={{ color: 'var(--violet)' }}>{M(L.carry(D, a), ctx)}</b><span className="small">比例 {(L.rateOf(D, a) * 100).toFixed(0)}%</span></div>
      </> : <>
        <div className="kpi"><span className="small">浮动盈亏</span><b className={L.cls(items.reduce((s, x) => s + L.holdingValue(x.h, D) - L.holdingCost(x.h, D), 0))}>{M(items.reduce((s, x) => s + L.holdingValue(x.h, D) - L.holdingCost(x.h, D), 0), ctx, { s: 1 })}</b><span className="small">按持仓成本</span></div>
        <div className="kpi"><span className="small">我的总资产（含 carry）</span><b style={{ color: 'var(--violet)' }}>{M(L.totals(D).mine, ctx)}</b><span className="small">+ carry {M(L.totals(D).cr, ctx, { c: 1 })}</span></div>
        <div className="kpi"><span className="small">持仓</span><b>{items.length} 项</b></div>
      </>}
    </div>
    {a.type === 'lp' && <CarryPanel ctx={ctx} a={a} />}
    <section className="card"><div className="card-h"><h3>持仓</h3><span className="small">点一行修改数量或成本</span></div><HoldList ctx={ctx} items={items} canEdit /></section>
    {a.type === 'lp' && <Flows ctx={ctx} a={a} canEdit />}
  </>);
}
export function Holdings(ctx) {
  const { D } = ctx; const items = D.accounts.flatMap((a) => L.acctHoldings(D, a.id).map((h) => ({ h, a })));
  const tot = items.reduce((s, x) => s + L.holdingValue(x.h, D), 0);
  return (<section className="card"><div className="card-h"><h3>全部持仓</h3><div className="btns"><span className="small" style={{ alignSelf: 'center' }}>{items.length} 项 · {M(tot, ctx)}</span><button className="btn pri" onClick={() => ctx.open({ k: 'add' })}>＋ 添加资产</button></div></div><HoldList ctx={ctx} items={items} showAcct canEdit /></section>);
}
export function Carry(ctx) {
  const { D } = ctx; const t = L.totals(D); const lps = D.accounts.filter((a) => a.type === 'lp');
  return (<>
    <div className="kpis">
      <div className="kpi"><span className="small">carry 合计</span><b style={{ color: 'var(--violet)' }}>{M(t.cr, ctx)}</b><span className="small">随行情实时变化</span></div>
      <div className="kpi"><span className="small">我的总资产</span><b>{M(t.mine, ctx)}</b><span className="small">自有资金 + carry</span></div>
      <div className="kpi"><span className="small">carry 占我的总资产</span><b>{t.mine ? (t.cr / t.mine * 100).toFixed(1) : 0}%</b></div>
      <div className="kpi"><span className="small">收 carry 的 LP</span><b>{lps.filter((a) => L.rateOf(D, a) > 0).length} / {lps.length}</b><span className="small">0% 的只代管</span></div>
    </div>
    {lps.length ? lps.map((a) => <div key={a.id}><div className="card-h" style={{ marginBottom: 6 }}><button className="back" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }} onClick={() => ctx.go('acct', a.id)}>{a.name} →</button></div><CarryPanel ctx={ctx} a={a} /></div>) : <div className="card"><div className="empty">还没有 LP 账户。</div></div>}
  </>);
}
export function Settings(ctx) {
  const { D, email } = ctx; const used = new Set(D.holdings.map((h) => h.instrument_id));
  const ids = D.instList.filter((i) => used.has(i.id) && i.class !== 'cash');
  const dm = D.settings?.default_modes || {};
  const setDef = async (k, m) => { await supabase.from('settings').update({ default_modes: { ...dm, [k]: m } }).eq('id', 1); ctx.toast('默认设置已更新'); };
  const setMode = async (i, m) => { await supabase.from('instruments').update({ price_mode: m }).eq('id', i.id); if (m === 'live') ctx.reload(); ctx.toast(`${i.name} 改为${m === 'live' ? '实时抓取' : '手动录入'}`); };
  const Seg = ({ v, on }) => <div className="seg"><button aria-pressed={v === 'live'} onClick={() => on('live')}>实时抓取</button><button aria-pressed={v === 'manual'} onClick={() => on('manual')}>手动录入</button></div>;
  return (<>
    <section className="card"><div className="card-h"><h3>价格来源 · 按类别默认</h3><span className="small">新添加的资产按这里的默认设置</span></div>
      <div className="rows">
        {[['stock', '股票', '港股为免费行情，约 15 分钟延迟'], ['etf', 'ETF', ''], ['crypto', '加密货币', '交易所实时']].map(([k, n, d]) => <div key={k} className="row"><div className="grow"><div className="nm">{n}</div><div className="small">{d}</div></div><Seg v={dm[k] || 'live'} on={(m) => setDef(k, m)} /></div>)}
        <div className="row"><div className="grow"><div className="nm">现金</div><div className="small">数量手动录入，汇率自动更新</div></div><span className="chip teal">汇率实时折算</span></div>
        <div className="row"><div className="grow"><div className="nm">另类资产</div><div className="small">私募、房产、公司股权：没有公开行情</div></div><span className="chip">手动录入（固定）</span></div>
      </div></section>
    <section className="card"><div className="card-h"><h3>价格来源 · 每个资产</h3><span className="small">{ids.length} 个在用资产</span></div>
      {ids.length ? <div className="rows">{ids.map((i) => <div key={i.id} className="row"><div className="grow"><div className="nm">{i.name}</div><div className="sub"><span>{i.symbol}</span><span>{L.CLS[i.class].n}</span></div></div><div className="r w v">{L.px(L.priceOf(i, D.prices, D.live), i.ccy, i.class === 'alt')}</div>{i.class === 'alt' ? <button className="chip" onClick={() => ctx.open({ k: 'val', inst: i })}>手动估值 ✎</button> : <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}><Seg v={i.price_mode} on={(m) => setMode(i, m)} />{i.price_mode === 'manual' && <button className="back" style={{ fontSize: 12 }} onClick={() => ctx.open({ k: 'val', inst: i })}>改手动价格 ✎</button>}</div>}</div>)}</div> : <div className="empty">还没有在用的资产。</div>}
      <p className="note">同一个标的只有一个价格：改成手动录入后，所有持有它的账户都用你录入的价格。</p></section>
    <section className="card"><div className="card-h"><h3>账户与登录</h3></div>
      <div className="rows"><div className="row"><div className="grow"><div className="nm">GP 登录邮箱</div><div className="small">用这个邮箱登录的人就是管理人</div></div><span className="chip">{email}</span></div>
        {D.accounts.filter((a) => a.type === 'lp').map((a) => <div key={a.id} className="row"><div className="grow"><div className="nm">{a.name}</div><div className="small">{a.lp_email || '未设置登录邮箱'}</div></div><button className="btn" onClick={() => ctx.open({ k: 'acct', a })}>编辑</button></div>)}</div>
      <p className="note">LP 用自己的邮箱登录，会收到登录链接，不需要密码。你在账户里填上对方邮箱就等于邀请了。</p></section>
    <section className="card"><div className="card-h"><h3>安装到手机</h3></div><p className="muted" style={{ margin: 0 }}>iPhone：用 Safari 打开这个网址 → 分享 → 「添加到主屏幕」。Android：Chrome 菜单 → 「安装应用」。之后就像 App 一样全屏打开。</p></section>
  </>);
}

/* ---------- LP views ---------- */
export function LpHome(ctx) {
  const { D, a } = ctx; const n = L.nav(D, a), d = L.dayChange(D, a), p = L.profit(D, a);
  const s = useMemo(() => navSeries(D, [a], (r) => +r.nav_usd), [D, a]);
  return (<>
    <section className="card"><div className="muted">{a.name} · 我的账户净值</div><div className="big">{M(n, ctx)}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}><span className={'chip ' + (d >= 0 ? 'teal' : 'warn')}>{M(d, ctx, { s: 1 })} · {L.pct(n - d ? d / (n - d) : 0)}</span><span className="small">今日</span></div>
      <div style={{ display: 'flex', gap: 26, marginTop: 18, fontSize: 13 }} className="muted"><span>投入本金 <b style={{ color: 'var(--ink)' }}>{M(+a.net_contribution, ctx)}</b></span><span>累计收益 <b className={L.cls(p)}>{M(p, ctx, { s: 1 })}{+a.net_contribution ? ' · ' + L.pct(p / +a.net_contribution) : ''}</b></span></div></section>
    <div className="two"><section className="card"><div className="card-h"><h3>净值走势</h3></div><LineChart series={[{ v: s, color: '#0E8C80', fill: 1 }]} ccy={ctx.ccy} fx={D.fx} /></section>
      <section className="card"><div className="card-h"><h3>资产配置</h3></div><Alloc D={D} accounts={[a]} ctx={ctx} /></section></div>
    <p className="note" style={{ margin: 0 }}>你的资金在独立账户中，由 hank 管理。你只能看到自己的账户，价格自动更新。</p>
  </>);
}
export function LpHoldings(ctx) { const { D, a } = ctx; const items = L.acctHoldings(D, a.id).map((h) => ({ h, a })); return <section className="card"><div className="card-h"><h3>持仓</h3><span className="small">{items.length} 项 · {M(L.nav(D, a), ctx)}</span></div><HoldList ctx={ctx} items={items} /></section>; }
export function LpFlows(ctx) { return <Flows ctx={ctx} a={ctx.a} />; }
