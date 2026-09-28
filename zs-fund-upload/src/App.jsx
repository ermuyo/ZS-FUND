import { useEffect, useState } from 'react';
import { supabase } from './lib.js';
import { useData } from './data.js';
import * as V from './views.jsx';
import { Modal } from './modals.jsx';

const NAV = {
  gp: [['home', '总览'], ['accounts', '账户'], ['holdings', '持仓'], ['carry', 'Carry'], ['settings', '设置']],
  lp: [['home', '我的账户'], ['holdings', '持仓'], ['flows', '流水']],
};

export default function App() {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  if (session === undefined) return <div className="aurora" />;
  if (!session) return <Login />;
  return <Main session={session} />;
}

function Login() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState('idle');
  const [err, setErr] = useState('');
  const send = async (e) => {
    e.preventDefault(); setErr(''); setState('sending');
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: window.location.origin } });
    if (error) { setErr(error.message); setState('idle'); } else setState('sent');
  };
  return (
    <div className="login"><div className="aurora" />
      <form className="card" onSubmit={send}>
        <div className="brand"><i />ZS FUND</div>
        {state === 'sent' ? (
          <><h3 style={{ margin: 0 }}>查看你的邮箱</h3><p className="muted" style={{ margin: 0 }}>我们给 {email} 发了一封登录邮件，点里面的链接就能进入。可以关掉这个页面。</p>
            <button type="button" className="back" onClick={() => setState('idle')}>换一个邮箱</button></>
        ) : (
          <><h3 style={{ margin: 0 }}>登录</h3><p className="muted" style={{ margin: 0 }}>输入你的邮箱，我们会发一个登录链接，不需要密码。</p>
            <label htmlFor="email" className="small">邮箱</label>
            <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            {err && <div className="dn" style={{ fontSize: 13 }}>{err}</div>}
            <button className="btn pri" disabled={state === 'sending'}>{state === 'sending' ? '发送中…' : '发送登录链接'}</button></>
        )}
      </form>
    </div>
  );
}

function Main({ session }) {
  const [D, reload] = useData(session);
  const [view, setView] = useState({ v: 'home' });
  const [ccy, setCcy] = useState(() => { try { return localStorage.getItem('zsfund-ccy') || 'USD'; } catch { return 'USD'; } });
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState('');
  useEffect(() => { try { localStorage.setItem('zsfund-ccy', ccy); } catch { /* ignore */ } }, [ccy]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 2600); return () => clearTimeout(t); } }, [toast]);
  useEffect(() => { window.scrollTo(0, 0); }, [view.v, view.id]);

  if (!D.ready) return <div className="aurora" />;
  const role = D.isGp ? 'gp' : 'lp';
  const myAcct = !D.isGp ? D.accounts[0] : null;
  const ctx = { D, ccy, reload, go: (v, id) => setView({ v, id, from: view.v === 'acct' ? view.from : view.v }), open: setModal, toast: setToast, view };
  const nav = NAV[role];
  const cur = (k) => (view.v === k || (view.v === 'acct' && k === (view.from || 'home')) ? 'page' : undefined);

  let body;
  if (!D.isGp && !myAcct) body = <div className="card"><h3>还没有关联的账户</h3><p className="muted">请让管理人把你的邮箱（{session.user.email}）添加到你的账户，然后刷新页面。</p></div>;
  else if (D.isGp) body = view.v === 'accounts' ? <V.Accounts {...ctx} /> : view.v === 'acct' ? <V.AccountDetail {...ctx} id={view.id} /> : view.v === 'holdings' ? <V.Holdings {...ctx} /> : view.v === 'carry' ? <V.Carry {...ctx} /> : view.v === 'settings' ? <V.Settings {...ctx} email={session.user.email} /> : <V.Overview {...ctx} />;
  else body = view.v === 'holdings' ? <V.LpHoldings {...ctx} a={myAcct} /> : view.v === 'flows' ? <V.LpFlows {...ctx} a={myAcct} /> : <V.LpHome {...ctx} a={myAcct} />;

  return (
    <>
      <div className="aurora" />
      <div className="shell">
        <header className="top">
          <div className="brand"><i />ZS FUND</div>
          <nav className="pillnav">{nav.map(([k, n]) => <button key={k} aria-current={cur(k)} onClick={() => setView({ v: k })}>{n}</button>)}</nav>
          <div className="topr">
            <span className="sync"><i /><span>已同步</span></span>
            <select className="ccy" aria-label="显示币种" value={ccy} onChange={(e) => setCcy(e.target.value)}>{['USD', 'HKD', 'CNY'].map((c) => <option key={c}>{c}</option>)}</select>
            <button className="avatar" title={`${session.user.email} · 退出登录`} onClick={() => supabase.auth.signOut()}>{(session.user.email || '?')[0].toUpperCase()}</button>
          </div>
        </header>
        {body}
      </div>
      <nav className="botnav">{nav.slice(0, 4).map(([k, n]) => <button key={k} aria-current={cur(k)} onClick={() => setView({ v: k })}>{n}</button>)}</nav>
      {modal && <Modal {...ctx} m={modal} close={() => setModal(null)} />}
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
