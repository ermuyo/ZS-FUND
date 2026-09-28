import { useEffect, useState } from 'react';
import { supabase } from './lib.js';
import * as L from './lib.js';
import { ensureInstrument, refreshPrices } from './data.js';

const M = (usd, ctx, o) => L.money(usd, ctx.ccy, ctx.D.fx, o);

export function Modal(props) {
  const { m, close } = props;
  useEffect(() => { const k = (e) => e.key === 'Escape' && close(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [close]);
  const Body = { add: AddAsset, edit: EditHolding, flow: Flow, val: ManualPrice, acct: AccountForm }[m.k];
  return <div className="layer" onClick={(e) => e.target === e.currentTarget && close()}><div className="dlg" role="dialog" aria-modal="true"><Body {...props} /></div></div>;
}
function Err({ e }) { return e ? <div className="err">{e}</div> : null; }
function AcctSel({ D, v, on }) { return <label>加到哪个账户<select value={v} onChange={(e) => on(e.target.value)}>{D.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.type === 'lp' ? '（LP）' : ''}</option>)}</select></label>; }
const FUND = { cash: '从这个账户的现金里扣除「数量 × 成本价」；币种不同时按今天汇率折算。', contrib: '按「数量 × 成本价」记为 LP 新入金，计入净投入本金，不算利润。', none: '只登记持仓，现金和本金都不变。适合第一次把已有资产录进系统。' };
function FundSeg({ D, acct, isCash, v, on }) {
  const lp = D.accounts.find((a) => a.id === acct)?.type === 'lp';
  const opts = [...(isCash ? [] : [['cash', '用账户现金买入']]), ['contrib', 'LP 新入金'], ['none', '仅录入持仓']];
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><span className="small">资金从哪来</span><div className="seg">{opts.map(([k, n]) => <button key={k} type="button" aria-pressed={v === k} disabled={k === 'contrib' && !lp} onClick={() => on(k)}>{n}</button>)}</div><span className="small">{FUND[v]}{v === 'none' && lp ? ' LP 账户慎用：市值会全部算作利润，影响 carry。' : ''}</span></div>;
}
async function payFor(D, acctId, ccy, amountNative) {
  // Pay from same-currency cash first; otherwise pay from any cash the account holds, converted at today's FX.
  const usdNeeded = amountNative * (D.fx[ccy] || 1);
  const cashRows = D.holdings.filter((x) => x.account_id === acctId && D.inst[x.instrument_id]?.class === 'cash').map((x) => ({ h: x, i: D.inst[x.instrument_id], usd: +x.qty * (D.fx[D.inst[x.instrument_id].ccy] || 1) }))
    .sort((a, b) => (a.i.ccy === ccy ? -1 : b.i.ccy === ccy ? 1 : b.usd - a.usd));
  const totalUsd = cashRows.reduce((s, r) => s + r.usd, 0);
  if (totalUsd < usdNeeded - 0.01) return `账户里的现金不够（折合约 $${Math.round(totalUsd).toLocaleString()}，需要约 $${Math.round(usdNeeded).toLocaleString()}）。可以改成「LP 新入金」或「仅录入持仓」，或先记录入金。`;
  let left = usdNeeded;
  for (const r of cashRows) {
    if (left <= 0.005) break;
    const take = Math.min(r.usd, left); const qtyTake = take / (D.fx[r.i.ccy] || 1);
    await supabase.from('holdings').update({ qty: Math.max(0, +r.h.qty - qtyTake), updated_at: new Date().toISOString() }).eq('id', r.h.id);
    left -= take;
  }
  return null;
}
async function addHolding(D, acctId, instId, qty, cost) {
  const h = D.holdings.find((x) => x.account_id === acctId && x.instrument_id === instId);
  if (h) { const q = +h.qty + qty; await supabase.from('holdings').update({ qty: q, avg_cost: (+h.qty * +h.avg_cost + qty * cost) / q, updated_at: new Date().toISOString() }).eq('id', h.id); return true; }
  const { error } = await supabase.from('holdings').insert({ account_id: acctId, instrument_id: instId, qty, avg_cost: cost }); if (error) throw error; return false;
}
async function contrib(D, acctId, usd, note) { const a = D.accounts.find((x) => x.id === acctId); if (a?.type === 'lp' && usd > 0) await supabase.from('cashflows').insert({ account_id: acctId, kind: 'transfer_in', amount_usd: usd, note }); }

/* ---------- add asset ---------- */
function AddAsset({ D, m, close, toast, reload }) {
  const [acct, setAcct] = useState(m.acct || D.accounts[0]?.id);
  const [lib, setLib] = useState(null); const [q, setQ] = useState(''); const [pick, setPick] = useState(null);
  const [mode, setMode] = useState('live'); const [fund, setFund] = useState(null); const [qty, setQty] = useState(''); const [cost, setCost] = useState(''); const [pxIn, setPxIn] = useState('');
  const [cname, setCname] = useState(''); const [ctype, setCtype] = useState('私募基金'); const [cccy, setCccy] = useState('USD'); const [cval, setCval] = useState(''); const [cdate, setCdate] = useState(L.today()); const [ccost, setCcost] = useState('');
  const [tname, setTname] = useState(''); const [tcls, setTcls] = useState('stock');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { L.loadLib().then(setLib); }, []);
  const lp = D.accounts.find((a) => a.id === acct)?.type === 'lp';
  useEffect(() => { if (!pick) return; const isCash = pick.cls === 'cash'; setFund(lp ? (isCash ? 'contrib' : 'cash') : (isCash ? 'none' : 'cash')); const ex = D.instList.find((i) => i.symbol === pick.sym); setMode(ex ? ex.price_mode : (D.settings?.default_modes?.[pick.cls] || 'live')); }, [pick, acct]); // eslint-disable-line

  if (!pick) {
    const { list, total } = lib ? L.search(lib, q) : { list: [], total: 0 };
    const gt = L.guessTicker(q); const showCode = gt && !list.some((c) => c.sym === gt.sym);
    const cashOpts = D.instList.filter((i) => i.class === 'cash').map((i) => ({ sym: i.symbol, name: i.name, cls: 'cash', ccy: i.ccy, market: 'CASH' }));
    const shown = q.trim() ? list : [];
    return (<>
      <h3>添加资产</h3><AcctSel D={D} v={acct} on={setAcct} />
      <label>搜索标的<input autoFocus type="search" placeholder="代码或名称：BTC、0700、泡泡玛特、AAPL…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && shown[0]) setPick(shown[0]); }} /></label>
      <div className="sr">
        {!q.trim() && <>{cashOpts.map((c) => <button key={c.sym} type="button" className="sri" onClick={() => setPick(c)}><span className="sy">{c.sym}</span><span>{c.name}<small>现金 · {c.ccy}</small></span><span className="chip teal">汇率折算</span></button>)}<div className="small" style={{ padding: '4px 2px' }}>{lib ? '输入代码或名称搜索全市场标的（加密货币、港股、美股、A 股）' : '正在加载标的库…'}</div></>}
        {total > shown.length && <div className="small">共 {total.toLocaleString()} 个结果，显示最相关的 {shown.length} 个</div>}
        {shown.map((c) => <button key={c.sym} type="button" className="sri" onClick={() => setPick(c)}><span className="sy">{c.sym}</span><span>{c.name}<small>{[L.MARKET_N[c.market], L.CLS[c.cls]?.n, c.ccy].filter(Boolean).join(' · ')}{D.instList.some((i) => i.symbol === c.sym) ? ' · 已在系统中' : ''}</small></span><span className="chip teal">{c.cls === 'crypto' ? '实时' : '延迟 15 分'}</span></button>)}
        {showCode && <button type="button" className="sri dash" onClick={() => setPick({ sym: gt.sym, name: gt.sym, cls: 'stock', ccy: gt.ccy, market: gt.market, byCode: true })}><span className="sy">{gt.sym}</span><span>按代码添加 {gt.sym}<small>{L.MARKET_N[gt.market]} · 标的库里没有，由行情源识别价格</small></span><span className="chip">行情</span></button>}
        {q.trim() && !shown.length && !showCode && <div className="small" style={{ padding: '4px 2px' }}>没找到「{q}」。换个写法试试，或添加为自定义资产。</div>}
        <button type="button" className="sri dash" onClick={() => setPick({ custom: true })}><span className="sy">+ 自定义</span><span>自定义资产<small>私募、房产、公司股权等，手动估值</small></span><span className="chip">手动</span></button>
      </div>
      <div className="btns"><button type="button" className="btn" onClick={close}>取消</button></div>
    </>);
  }

  if (pick.custom) {
    const submit = async (e) => {
      e.preventDefault(); setErr(''); const v = parseFloat(cval), cb = parseFloat(ccost);
      if (!cname.trim()) return setErr('请填写名称。'); if (!(v >= 0)) return setErr('请填写当前估值。');
      setBusy(true);
      try {
        const costT = cb >= 0 ? cb : v;
        if (fund === 'cash') { const er = await payFor(D, acct, cccy, costT); if (er) { setErr(er); setBusy(false); return; } }
        const inst = await ensureInstrument({ sym: 'custom:' + crypto.randomUUID().slice(0, 8), name: cname.trim(), cls: 'alt', ccy: cccy, market: 'OTHER' }, 'manual');
        await supabase.from('prices').upsert({ instrument_id: inst.id, price: v, prev_close: v, source: 'manual', delayed: false, as_of: cdate + 'T12:00:00Z' });
        await addHolding(D, acct, inst.id, 1, costT);
        if (fund === 'contrib') await contrib(D, acct, costT * (D.fx[cccy] || 1), '资产转入 · ' + cname.trim());
        toast(`已添加：${cname.trim()}`); close(); reload();
      } catch (ex) { setErr(String(ex.message || ex)); setBusy(false); }
    };
    return (<form onSubmit={submit} style={{ display: 'contents' }}>
      <h3>添加自定义资产</h3><div className="pick"><div style={{ flexGrow: 1 }}><b>自定义资产</b><div className="small">没有公开行情，价格来源固定为手动录入</div></div><button type="button" className="back" onClick={() => setPick(null)}>换一个</button></div>
      <AcctSel D={D} v={acct} on={setAcct} />
      <label>名称<input required value={cname} onChange={(e) => setCname(e.target.value)} placeholder="如：上海徐汇公寓、某成长基金 III 期" /></label>
      <div className="two" style={{ gap: 10 }}><label>类型<select value={ctype} onChange={(e) => setCtype(e.target.value)}>{['私募基金', '房产', '私有公司股权', '其他'].map((t) => <option key={t}>{t}</option>)}</select></label><label>币种<select value={cccy} onChange={(e) => setCccy(e.target.value)}>{['USD', 'HKD', 'CNY', 'JPY', 'EUR'].map((c) => <option key={c}>{c}</option>)}</select></label></div>
      <div className="two" style={{ gap: 10 }}><label>当前估值（总额）<input type="number" min="0" step="any" required value={cval} onChange={(e) => setCval(e.target.value)} /></label><label>估值日期<input type="date" value={cdate} onChange={(e) => setCdate(e.target.value)} /></label></div>
      <label>投入成本（总额，可选）<input type="number" min="0" step="any" value={ccost} onChange={(e) => setCcost(e.target.value)} /></label>
      <FundSeg D={D} acct={acct} isCash={false} v={fund || 'none'} on={setFund} />
      <Err e={err} /><div className="btns"><button type="button" className="btn" onClick={close}>取消</button><button className="btn pri" disabled={busy}>添加到账户</button></div>
    </form>);
  }

  const c = pick, isCash = c.cls === 'cash', ex = D.instList.find((i) => i.symbol === c.sym);
  const curPx = ex ? L.priceOf(ex, D.prices, D.live) : null;
  const q1 = parseFloat(qty), cost1 = isCash ? 1 : parseFloat(cost);
  const pxUse = curPx ?? (parseFloat(pxIn) || null);
  const preview = q1 > 0 && (pxUse || cost1 >= 0) ? `市值约 ${M(q1 * (pxUse ?? cost1) * (D.fx[c.ccy] || 1), { ccy: 'USD', D })}` + (!isCash && cost1 >= 0 ? `，成本 ${L.SYM[c.ccy] || ''}${(q1 * cost1).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '') : '';
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (!(q1 > 0)) return setErr(isCash ? '请输入金额。' : '请输入数量。');
    const costV = isCash ? 1 : (cost === '' ? (pxUse ?? NaN) : cost1); if (!isCash && !(costV >= 0)) return setErr('请输入成本价。');
    setBusy(true);
    try {
      if (fund === 'cash') { const er = await payFor(D, acct, c.ccy, q1 * costV); if (er) { setErr(er); setBusy(false); return; } }
      const spec = c.byCode ? { ...c, name: tname.trim() || c.sym, cls: tcls } : c;
      const inst = await ensureInstrument(spec, isCash ? undefined : mode);
      if (!isCash && mode === 'manual' && !D.prices[inst.id]) await supabase.from('prices').upsert({ instrument_id: inst.id, price: parseFloat(pxIn) || costV, prev_close: parseFloat(pxIn) || costV, source: 'manual', delayed: false });
      const merged = await addHolding(D, acct, inst.id, q1, costV);
      if (fund === 'contrib') await contrib(D, acct, q1 * costV * (D.fx[c.ccy] || 1), isCash ? '入金' : '资产转入 · ' + c.sym);
      toast(`${merged ? '已合并到现有持仓' : '已添加'}：${spec.name}`); close(); reload();
      if (!isCash && mode === 'live' && !curPx) refreshPrices().then(reload);
    } catch (ex) { setErr(String(ex.message || ex)); setBusy(false); }
  };
  return (<form onSubmit={submit} style={{ display: 'contents' }}>
    <h3>添加资产</h3>
    <div className="pick"><div style={{ flexGrow: 1, minWidth: 0 }}><b>{c.byCode ? c.sym : c.name}</b><div className="small">{c.sym} · {[L.MARKET_N[c.market], L.CLS[c.cls]?.n, c.ccy].filter(Boolean).join(' · ')}</div></div>{curPx != null && !isCash && <div className="r"><b>{L.px(curPx, c.ccy)}</b><div className="small">当前价</div></div>}<button type="button" className="back" onClick={() => setPick(null)}>换一个</button></div>
    {c.byCode && <div className="two" style={{ gap: 10 }}><label>名称（可选）<input value={tname} onChange={(e) => setTname(e.target.value)} placeholder="留空则用代码" /></label><label>类别<select value={tcls} onChange={(e) => setTcls(e.target.value)}><option value="stock">股票</option><option value="etf">ETF</option>{c.market === 'US' && <option value="crypto">加密货币</option>}</select></label></div>}
    <AcctSel D={D} v={acct} on={setAcct} />
    {isCash ? <label>金额（{c.ccy}）<input autoFocus type="number" min="0" step="any" required value={qty} onChange={(e) => setQty(e.target.value)} /></label>
      : <div className="two" style={{ gap: 10 }}><label>数量<input autoFocus type="number" min="0" step="any" required value={qty} onChange={(e) => setQty(e.target.value)} /></label><label>成本价（每单位，{c.ccy}）<input type="number" min="0" step="any" value={cost} onChange={(e) => setCost(e.target.value)} placeholder={curPx != null ? '留空 = 当前价' : ''} /></label></div>}
    {!isCash && <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><span className="small">价格来源{ex ? '（已在系统中，改动对所有账户生效）' : ''}</span><div className="seg"><button type="button" aria-pressed={mode === 'live'} onClick={() => setMode('live')}>实时抓取</button><button type="button" aria-pressed={mode === 'manual'} onClick={() => setMode('manual')}>手动录入</button></div><span className="small">{mode === 'live' ? (c.cls === 'crypto' ? '交易所实时更新。' : '免费行情，约 15 分钟延迟。') : '价格固定为你录入的数，之后手动更新。'}</span></div>}
    {!isCash && mode === 'manual' && curPx == null && <label>当前价格（{c.ccy}）<input type="number" min="0" step="any" value={pxIn} onChange={(e) => setPxIn(e.target.value)} placeholder="留空则用成本价" /></label>}
    <FundSeg D={D} acct={acct} isCash={isCash} v={fund || 'none'} on={setFund} />
    {preview && <div className="small">{preview}</div>}
    <Err e={err} /><div className="btns"><button type="button" className="btn" onClick={close}>取消</button><button className="btn pri" disabled={busy}>添加到账户</button></div>
  </form>);
}

/* ---------- edit holding ---------- */
function EditHolding({ D, m, close, toast, reload }) {
  const { h, a } = m; const i = D.inst[h.instrument_id];
  const [qty, setQty] = useState(String(+h.qty)); const [cost, setCost] = useState(String(+h.avg_cost)); const [err, setErr] = useState(''); const [arm, setArm] = useState(false);
  const save = async (e) => { e.preventDefault(); const q = parseFloat(qty), c = parseFloat(cost); if (!(q > 0)) return setErr('数量需要大于 0。要清掉这项，请用「删除」。'); await supabase.from('holdings').update({ qty: q, avg_cost: c >= 0 ? c : +h.avg_cost, updated_at: new Date().toISOString() }).eq('id', h.id); toast(`已更新 ${i.name}`); close(); reload(); };
  const del = async () => { if (!arm) return setArm(true); await supabase.from('holdings').delete().eq('id', h.id); toast(`已从 ${a.name} 删除 ${i.name}`); close(); reload(); };
  return (<form onSubmit={save} style={{ display: 'contents' }}>
    <h3>编辑持仓 · {i.name}</h3><p>{a.name} · {i.symbol} · {i.class === 'cash' ? '汇率折算' : i.price_mode === 'live' ? '实时抓取' : '手动录入'}</p>
    {i.class === 'cash' ? <label>金额（{i.ccy}）<input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
      : i.class === 'alt' ? <><label>投入成本（总额，{i.ccy}）<input type="number" min="0" step="any" value={cost} onChange={(e) => setCost(e.target.value)} /></label><p className="small">要更新估值，请在持仓列表点「手动估值」标签。</p></>
        : <div className="two" style={{ gap: 10 }}><label>数量<input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} /></label><label>成本价（{i.ccy}）<input type="number" min="0" step="any" value={cost} onChange={(e) => setCost(e.target.value)} /></label></div>}
    <p className="small">改数量只修正记录，不动现金和本金。买卖请用「添加资产」或记录入金 / 出金。</p>
    <Err e={err} /><div className="btns" style={{ justifyContent: 'space-between' }}><button type="button" className="btn danger" onClick={del}>{arm ? '再点一次确认删除' : '删除这项持仓'}</button><span style={{ display: 'flex', gap: 8 }}><button type="button" className="btn" onClick={close}>取消</button><button className="btn pri">保存</button></span></div>
  </form>);
}

/* ---------- deposit / withdrawal ---------- */
function Flow({ D, m, close, toast, reload }) {
  const { a, t } = m; const isIn = t === 'deposit';
  const [amt, setAmt] = useState(''); const [date, setDate] = useState(L.today()); const [note, setNote] = useState(''); const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault(); const v = parseFloat(amt); if (!(v > 0)) return setErr('请输入大于 0 的金额。');
    const usd = D.instList.find((i) => i.symbol === 'USD'); const h = D.holdings.find((x) => x.account_id === a.id && x.instrument_id === usd.id);
    if (!isIn && (!h || +h.qty < v)) return setErr(`美元现金只有 $${(+h?.qty || 0).toLocaleString()}，请先卖出资产或减少金额。`);
    if (h) await supabase.from('holdings').update({ qty: +h.qty + (isIn ? v : -v), updated_at: new Date().toISOString() }).eq('id', h.id);
    else await supabase.from('holdings').insert({ account_id: a.id, instrument_id: usd.id, qty: v, avg_cost: 1 });
    await supabase.from('cashflows').insert({ account_id: a.id, date, kind: t, amount_usd: v, note: note || null });
    toast(`已记录 ${a.name} ${isIn ? '入金' : '出金'} $${v.toLocaleString()}`); close(); reload();
  };
  return (<form onSubmit={submit} style={{ display: 'contents' }}>
    <h3>{isIn ? '记录入金' : '记录出金'} · {a.name}</h3>
    <label>金额（美元）<input autoFocus type="number" min="1" step="any" required value={amt} onChange={(e) => setAmt(e.target.value)} /></label>
    <label>日期<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
    <label>备注（可选）<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
    <p>{isIn ? '入金会加到美元现金和净投入本金上，所以不会被算成利润。' : '出金从美元现金扣除，同时减少净投入本金。'}</p>
    <Err e={err} /><div className="btns"><button type="button" className="btn" onClick={close}>取消</button><button className="btn pri">保存</button></div>
  </form>);
}

/* ---------- manual price / valuation ---------- */
function ManualPrice({ D, m, close, toast, reload }) {
  const i = m.inst; const cur = D.prices[i.id]; const isAlt = i.class === 'alt';
  const [v, setV] = useState(cur ? String(+cur.price) : ''); const [d, setD] = useState(L.today()); const [err, setErr] = useState('');
  const submit = async (e) => { e.preventDefault(); const p = parseFloat(v); if (!(p >= 0)) return setErr('请填写价格。'); await supabase.from('prices').upsert({ instrument_id: i.id, price: p, prev_close: p, source: 'manual', delayed: false, as_of: d + 'T12:00:00Z' }); toast(`${i.name} ${isAlt ? '估值' : '价格'}已更新`); close(); reload(); };
  return (<form onSubmit={submit} style={{ display: 'contents' }}>
    <h3>{isAlt ? '更新估值' : '更新手动价格'} · {i.name}</h3>
    <p>{cur ? `当前 ${L.px(+cur.price, i.ccy, isAlt)}，日期 ${cur.as_of.slice(0, 10)}。` : '还没有价格。'}{isAlt ? '另类资产没有实时价格，系统显示最近一次估值及其日期。' : '这个标的设为手动录入，不跟随行情；可在「设置」里改回实时抓取。'}</p>
    <label>{isAlt ? '新估值（总额）' : '新价格'}（{i.ccy}）<input autoFocus type="number" min="0" step="any" required value={v} onChange={(e) => setV(e.target.value)} /></label>
    <label>日期<input type="date" value={d} onChange={(e) => setD(e.target.value)} /></label>
    <Err e={err} /><div className="btns"><button type="button" className="btn" onClick={close}>取消</button><button className="btn pri">保存</button></div>
  </form>);
}

/* ---------- account create / edit ---------- */
function AccountForm({ D, m, close, toast, reload }) {
  const a = m.a; const [name, setName] = useState(a?.name || ''); const [email, setEmail] = useState(a?.lp_email || ''); const [rate, setRate] = useState(a ? String(L.rateOf(D, a) * 100) : '20'); const [since, setSince] = useState(a?.since || L.today()); const [err, setErr] = useState(''); const [arm, setArm] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr(''); const r = parseFloat(rate); if (!name.trim()) return setErr('请填写名称。'); if (!(r >= 0 && r <= 100)) return setErr('比例需在 0 到 100 之间。');
    const row = { name: name.trim(), lp_email: email.trim() || null, since };
    let id = a?.id;
    if (a) { const { error } = await supabase.from('accounts').update(row).eq('id', a.id); if (error) return setErr(error.message.includes('accounts_lp_email_uq') ? '这个邮箱已经绑定了另一个账户。' : error.message); }
    else { const { data, error } = await supabase.from('accounts').insert({ ...row, type: 'lp' }).select().single(); if (error) return setErr(error.message.includes('accounts_lp_email_uq') ? '这个邮箱已经绑定了另一个账户。' : error.message); id = data.id; }
    await supabase.from('account_terms').upsert({ account_id: id, carry_rate: r / 100 });
    toast(a ? '账户已更新' : `已创建 ${name.trim()}`); close(); reload();
  };
  const del = async () => { if (!arm) return setArm(true); await supabase.from('accounts').delete().eq('id', a.id); toast('账户已删除'); close(); reload(); };
  return (<form onSubmit={submit} style={{ display: 'contents' }}>
    <h3>{a ? '编辑账户' : '新建 LP 账户'}</h3>
    <label>名称<input autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="如：王先生、陈氏家族" /></label>
    <label>LP 登录邮箱（可选，填了就等于邀请）<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="lp@example.com" /></label>
    <div className="two" style={{ gap: 10 }}><label>carry 比例（%）<input type="number" min="0" max="100" step="0.5" value={rate} onChange={(e) => setRate(e.target.value)} /></label><label>开户日期<input type="date" value={since} onChange={(e) => setSince(e.target.value)} /></label></div>
    <p>LP 用这个邮箱登录后，只能看到自己的账户：持仓、净值、流水。看不到 carry、其他 LP 和你的自有资金。</p>
    <Err e={err} /><div className="btns" style={{ justifyContent: a ? 'space-between' : 'flex-end' }}>{a && <button type="button" className="btn danger" onClick={del}>{arm ? '再点一次确认删除' : '删除账户'}</button>}<span style={{ display: 'flex', gap: 8 }}><button type="button" className="btn" onClick={close}>取消</button><button className="btn pri">保存</button></span></div>
  </form>);
}
