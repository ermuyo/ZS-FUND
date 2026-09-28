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
  const [mode, setMode] = useState('password');   // password | link
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [state, setState] = useState('idle');
  const [err, setErr] = useState('');
  const friendly = (m) => /rate limit/i.test(m) ? '登录邮件发送额度已用完，请改用密码登录。' : /Invalid login/i.test(m) ? '邮箱或密码不对。如果是第一次用，点「首次设置密码」。' : /already registered/i.test(m) ? '这个邮箱已经设置过密码，请直接登录。' : /Password should/i.test(m) ? '密码至少 6 位。' : m;
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setState('busy');
    const em = email.trim();
    if (mode === 'link') {
      const { error } = await supabase.auth.signInWithOtp({ email: em, options: { emailRedirectTo: window.location.origin } });
      if (error) { setErr(friendly(error.message)); setState('idle'); } else setState('sent');
      return;
    }
    if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({ email: em, password: pw, options: { emailRedirectTo: window.location.origin } });
      if (error) { setErr(friendly(error.message)); setState('idle'); return; }
      if (data.session) return;                      // confirmation disabled: signed in
      setState('needconfirm'); return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email: em, password: pw });
    if (error) { setErr(friendly(error.message)); setState('idle'); }
  };
  const title = mode === 'signup' ? '首次设置密码' : '登录';
  return (
    <div className="login"><div className="aurora" />
      <form className="card" onSubmit={submit}>
        <div className="brand"><i />ZS FUND</div>
        {state === 'sent' ? (
          <><h3 style={{ margin: 0 }}>查看你的邮箱</h3><p className="muted" style={{ margin: 0 }}>我们给 {email} 发了一封登录邮件，点里面的链接就能进入。</p>
            <button type="button" className="back" onClick={() => setState('idle')}>返回</button></>
        ) : state === 'needconfirm' ? (
          <><h3 style={{ margin: 0 }}>查看你的邮箱</h3><p className="muted" style={{ margin: 0 }}>我们给 {email} 发了一封确认邮件，点里面的链接后就可以用密码登录了。</p>
            <button type="button" className="back" onClick={() => { setState('idle'); setMode('password'); }}>返回登录</button></>
        ) : (
          <><h3 style={{ margin: 0 }}>{title}</h3>
            <p className="muted" style={{ margin: 0 }}>{mode === 'link' ? '输入邮箱，我们会发一个登录链接。' : mode === 'signup' ? '给你的邮箱设一个密码，之后用它登录。' : '用邮箱和密码登录。'}</p>
            <label htmlFor="email" className="small">邮箱</label>
            <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            {mode !== 'link' && <><label htmlFor="pw" className="small">密码</label>
              <input id="pw" type="password" required minLength={6} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={pw} onChange={(e) => setPw(e.target.value)} placeholder={mode === 'signup' ? '至少 6 位' : ''} /></>}
            {err && <div className="dn" style={{ fontSize: 13 }}>{err}</div>}
            <button className="btn pri" disabled={state === 'busy'}>{state === 'busy' ? '请稍候…' : mode === 'link' ? '发送登录链接' : mode === 'signup' ? '设置密码并登录' : '登录'}</button>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              {mode === 'password' && <button type="button" className="back" onClick={() => { setMode('signup'); setErr(''); }}>首次设置密码</button>}
              {mode !== 'password' && <button type="button" className="back" onClick={() => { setMode('password'); setErr(''); }}>用密码登录</button>}
              {mode !== 'link' && <button type="button" className="back" onClick={() => { setMode('link'); setErr(''); }}>改用邮件链接</button>}
            </div></>
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
