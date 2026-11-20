import { useState } from 'react';
import { BuyerFields, buyerBody, emptyBuyer, type BuyerForm } from '../ui/buyer';
import { useAuth } from '../ui/auth';
import { api, store } from '../api/client';
import type { Zone } from '../api/types';
import { Field, Icon, useQuery } from '../ui/kit';
import { Link, navigate, useLoc } from '../lib/router';
import { errorText } from '../lib/format';
import { LangPicker, useLang } from '../i18n';

function AuthFrame({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  const { t } = useLang();
  return (
    <div className="authpage">
      <div className="authcard">
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}><LangPicker /></div>
        <div className="logo big"><i><Icon name="heart" size={22} /></i> {t('app.name')}</div>
        <h1>{title}</h1>
        <p className="mute">{sub}</p>
        {children}
      </div>
    </div>
  );
}

const PAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

export function LoginPage() {
  const { login, pinLogin } = useAuth();
  const { t } = useLang();
  const [mode, setMode] = useState<'pwd' | 'pin'>(() => (store.get('carnet.loginMode') === 'pin' ? 'pin' : 'pwd'));
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState(() => store.get('carnet.phone') ?? '');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const choose = (m: 'pwd' | 'pin') => { setMode(m); setError(''); store.set('carnet.loginMode', m); };
  const { query } = useLoc();
  const justReset = query.get('reset') === '1';
  const done = () => navigate('/', true);

  const submitPwd = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await login(identifier.trim(), password); done(); } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };
  const press = async (k: string) => {
    if (busy) return;
    setError('');
    if (k === '⌫') return setPin((p) => p.slice(0, -1));
    if (!k) return;
    const next = (pin + k).slice(0, 4);
    setPin(next);
    if (next.length === 4) {
      setBusy(true);
      try { store.set('carnet.phone', phone); await pinLogin(phone.trim(), next); done(); }
      catch (err) { setError(errorText(err)); setPin(''); }
      finally { setBusy(false); }
    }
  };

  return (
    <AuthFrame title={t('auth.login')} sub={t('auth.loginSub')}>
      {justReset && <p className="banner info" role="status">Mot de passe changé. Vous pouvez vous connecter.</p>}
      <div className="seg" role="tablist" aria-label="Mode de connexion">
        <button role="tab" aria-selected={mode === 'pwd'} onClick={() => choose('pwd')}>{t('auth.password')}</button>
        <button role="tab" aria-selected={mode === 'pin'} onClick={() => choose('pin')}>{t('auth.pin')}</button>
      </div>
      {mode === 'pwd' ? (
        <form onSubmit={submitPwd} className="stack">
          <Field label={t('auth.phoneOrEmail')}>{(id) => <input id={id} value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" inputMode="email" required />}</Field>
          <Field label={t('auth.password')}>{(id) => <input id={id} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />}</Field>
          {error && <p className="err" role="alert">{error}</p>}
          <button className="btn pri block" disabled={busy}>{busy ? t('common.loading') : t('auth.submit')}</button>
          <p className="center"><Link to="/mot-de-passe-oublie">{t('auth.forgot')}</Link></p>
        </form>
      ) : (
        <div className="stack">
          <Field label={t('auth.yourPhone')} hint="Réservé aux éleveurs.">{(id) => <input id={id} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="07 12 34 56 78" />}</Field>
          <div className="pindots" aria-label={`${pin.length} chiffres saisis sur 4`}>{[0, 1, 2, 3].map((i) => <i key={i} className={i < pin.length ? 'on' : ''} />)}</div>
          {error && <p className="err center" role="alert">{error}</p>}
          <div className="pad">
            {PAD.map((k, i) => (
              <button key={i} type="button" className="padkey" disabled={!k || busy || (k !== '⌫' && !phone.trim())} onClick={() => press(k)} aria-label={k === '⌫' ? 'Effacer' : k || undefined}>{k}</button>
            ))}
          </div>
        </div>
      )}
      <p className="center mute">{t('auth.noAccount')} <Link to="/inscription">{t('auth.createAccount')}</Link></p>
    </AuthFrame>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const zones = useQuery(() => api.get<{ items: Zone[] }>('/zones'), []);
  const [role, setRole] = useState<'eleveur' | 'vet' | 'particulier'>('eleveur');
  const [f, setF] = useState({ name: '', phone: '', email: '', password: '', pin: '', zoneId: '', orderNumber: '', clinic: '' });
  const [buyer, setBuyer] = useState<BuyerForm>(emptyBuyer);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(''); setErrors({});
    const body: Record<string, unknown> = { role, name: f.name, phone: f.phone, password: f.password };
    if (f.email) body.email = f.email;
    if (f.zoneId) body.zoneId = f.zoneId;
    if (role === 'eleveur' && f.pin) body.pin = f.pin;
    if (role === 'vet') { body.orderNumber = f.orderNumber; if (f.clinic) body.clinic = f.clinic; }
    if (role === 'particulier') { const bb = buyerBody(buyer); if (Object.keys(bb).length) body.buyerProfile = bb; }
    try { await register(body); navigate('/', true); }
    catch (err: any) {
      if (err?.status === 422 && Array.isArray(err.details)) {
        const m: Record<string, string> = {};
        for (const d of err.details) { const k = d.path?.[0] === 'buyerProfile' ? d.path[1] : d.path?.[0]; if (k && !m[k]) m[k] = d.message; }
        setErrors(m);
      } else if (err?.code === 'phone_taken') setErrors({ phone: errorText(err) });
      else if (err?.code === 'email_taken') setErrors({ email: errorText(err) });
      else if (err?.code === 'order_number_taken') setErrors({ orderNumber: errorText(err) });
      else setError(errorText(err));
    } finally { setBusy(false); }
  };

  return (
    <AuthFrame title="Créer un compte" sub="Quelques informations suffisent.">
      <form onSubmit={submit} className="stack">
        <div className="seg" role="radiogroup" aria-label="Vous êtes">
          <button type="button" role="radio" aria-checked={role === 'eleveur'} aria-selected={role === 'eleveur'} onClick={() => setRole('eleveur')}>Éleveur</button>
          <button type="button" role="radio" aria-checked={role === 'vet'} aria-selected={role === 'vet'} onClick={() => setRole('vet')}>Vétérinaire</button>
          <button type="button" role="radio" aria-checked={role === 'particulier'} aria-selected={role === 'particulier'} onClick={() => setRole('particulier')}>Particulier (acheteur)</button>
        </div>
        <Field label="Nom complet" error={errors.name}>{(id) => <input id={id} value={f.name} onChange={set('name')} autoComplete="name" required />}</Field>
        <Field label="Téléphone" hint="10 chiffres, ex. 07 12 34 56 78" error={errors.phone}>{(id) => <input id={id} value={f.phone} onChange={set('phone')} inputMode="tel" autoComplete="tel" required />}</Field>
        <Field label="E-mail (facultatif)" error={errors.email}>{(id) => <input id={id} type="email" value={f.email} onChange={set('email')} autoComplete="email" />}</Field>
        <Field label="Zone" error={errors.zoneId}>{(id) => (
          <select id={id} value={f.zoneId} onChange={set('zoneId')}>
            <option value="">— Choisir —</option>
            {zones.data?.items.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        )}</Field>
        <Field label="Mot de passe" hint="8 caractères au minimum" error={errors.password}>{(id) => <input id={id} type="password" value={f.password} onChange={set('password')} autoComplete="new-password" required />}</Field>
        {role === 'eleveur' && (
          <Field label="Code à 4 chiffres (facultatif)" hint="Pour vous connecter plus simplement sur votre téléphone." error={errors.pin}>{(id) => <input id={id} value={f.pin} onChange={set('pin')} inputMode="numeric" maxLength={4} pattern="[0-9]{4}" />}</Field>
        )}
        {role === 'vet' && (
          <>
            <Field label="Numéro d'ordre" hint="Vérifié par l'autorité avant de pouvoir consulter des dossiers." error={errors.orderNumber}>{(id) => <input id={id} value={f.orderNumber} onChange={set('orderNumber')} required />}</Field>
            <Field label="Clinique (facultatif)">{(id) => <input id={id} value={f.clinic} onChange={set('clinic')} />}</Field>
          </>
        )}
        {role === 'particulier' && <BuyerFields value={buyer} onChange={setBuyer} errors={errors} />}
        {error && <p className="err" role="alert">{error}</p>}
        <button className="btn pri block" disabled={busy}>{busy ? 'Création…' : 'Créer mon compte'}</button>
      </form>
      <p className="center mute">Déjà un compte ? <Link to="/connexion">Se connecter</Link></p>
    </AuthFrame>
  );
}

/** Mot de passe oublié : on envoie un code à 6 chiffres par SMS, puis on choisit un nouveau mot de passe. */
export function ForgotPage() {
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [pwd, setPwd] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const ask = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api.post('/auth/forgot-password', { phone: phone.trim() }); setStep('code'); setInfo('Si ce numéro a un compte, un code à 6 chiffres vient de lui être envoyé par SMS. Il est valable 15 minutes.'); }
    catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };
  const reset = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api.post('/auth/reset-password', { phone: phone.trim(), code: code.trim(), newPassword: pwd }); store.set('carnet.phone', phone.trim()); navigate('/connexion?reset=1', true); }
    catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };
  return (
    <AuthFrame title="Mot de passe oublié" sub="Nous vous envoyons un code par SMS.">
      {step === 'phone' ? (
        <form onSubmit={ask} className="stack">
          <Field label="Votre numéro de téléphone">{(id) => <input id={id} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="07 12 34 56 78" required />}</Field>
          {error && <p className="err" role="alert">{error}</p>}
          <button className="btn pri block" disabled={busy}>{busy ? 'Envoi…' : 'Recevoir un code'}</button>
        </form>
      ) : (
        <form onSubmit={reset} className="stack">
          <p className="mute" role="status">{info}</p>
          <Field label="Code reçu (6 chiffres)">{(id) => <input id={id} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" required />}</Field>
          <Field label="Nouveau mot de passe" hint="8 caractères au minimum.">{(id) => <input id={id} type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="new-password" minLength={8} required />}</Field>
          {error && <p className="err" role="alert">{error}</p>}
          <button className="btn pri block" disabled={busy || code.length !== 6}>{busy ? 'Enregistrement…' : 'Changer mon mot de passe'}</button>
          <button type="button" className="btn block" onClick={() => { setStep('phone'); setCode(''); setError(''); }}>Renvoyer un code</button>
        </form>
      )}
      <p className="center mute"><Link to="/connexion">Retour à la connexion</Link></p>
    </AuthFrame>
  );
}
