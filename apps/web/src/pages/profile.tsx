import { useState } from 'react';
import { api } from '../api/client';
import type { BuyerProfile, User, Zone } from '../api/types';
import { BuyerFields, buyerBody, buyerFromProfile, emptyBuyer, type BuyerForm } from '../ui/buyer';
import { Badge, Card, Field, PageHead, useAction, useQuery, useToast } from '../ui/kit';
import { useAuth } from '../ui/auth';
import { ROLE_LABEL, phone } from '../lib/format';

export function applyTheme(t?: string): void {
  const r = document.documentElement;
  if (t === 'light' || t === 'dark') r.setAttribute('data-theme', t); else r.removeAttribute('data-theme');
}

/** Profil d'acheteur : profession et organisation représentée, montrées au vendeur quand on lui fait une demande. */
function BuyerProfileCard() {
  const toast = useToast();
  const { busy, run } = useAction();
  const [form, setForm] = useState<BuyerForm | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const q = useQuery(() => api.get<{ profile: BuyerProfile | null }>('/me/buyer-profile'), []);
  const v = form ?? (q.data ? buyerFromProfile(q.data.profile) : emptyBuyer);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErrs({});
    const r = await run(async () => {
      try { return await api.put<{ profile: BuyerProfile | null }>('/me/buyer-profile', buyerBody(v)); }
      catch (err: any) {
        if (err?.status === 422 && Array.isArray(err.details)) { const m: Record<string, string> = {}; for (const d of err.details) if (d.path?.[0]) m[d.path[0]] = d.message; setErrs(m); }
        throw err;
      }
    }, 'Profil acheteur enregistré');
    if (r) { setForm(null); q.reload(); toast('Les vendeurs verront ces informations avec vos demandes.', 'info'); }
  };
  return (
    <Card title="Profil acheteur">
      <form className="form" onSubmit={save}>
        <p className="mute">Les éleveurs voient ces informations quand vous leur faites une demande. Le numéro du responsable ne leur est transmis qu'après un accord.</p>
        <BuyerFields value={v} onChange={setForm} errors={errs} />
        <div className="actions end"><button className="btn pri" disabled={busy || q.loading && !q.data}>Enregistrer</button></div>
      </form>
    </Card>
  );
}

export function ProfilePage() {
  const { user, setUser, logout } = useAuth();
  const toast = useToast();
  const zones = useQuery(() => api.get<{ items: Zone[] }>('/zones'), []);
  const [name, setName] = useState(user!.name);
  const [email, setEmail] = useState(user!.email ?? '');
  const [zoneId, setZoneId] = useState(user!.zone?.id ?? '');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [pin, setPin] = useState({ password: '', pin: '' });
  const { busy, run } = useAction();

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErrs({});
    const r = await run(async () => {
      try { return await api.patch<User>('/me', { name: name.trim(), email: email.trim() || null, zoneId: zoneId || null }); }
      catch (err: any) {
        if (err?.status === 422 && Array.isArray(err.details)) { const m: Record<string, string> = {}; for (const d of err.details) if (d.path?.[0]) m[d.path[0]] = d.message; setErrs(m); }
        throw err;
      }
    }, 'Profil enregistré');
    if (r) setUser(r);
  };
  const pref = async (patch: Record<string, unknown>) => {
    const prefs = { ...user!.prefs, ...patch };
    const r = await run(() => api.patch<User>('/me', { prefs }));
    if (r) { setUser(r); applyTheme(r.prefs.theme); }
  };
  const changePw = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await run(() => api.post('/auth/change-password', pw), 'Mot de passe changé. Les autres appareils seront déconnectés.');
    if (r !== undefined) setPw({ currentPassword: '', newPassword: '' });
  };
  const savePin = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await run(() => api.post('/auth/pin', pin), 'Code à 4 chiffres enregistré');
    if (r !== undefined) setPin({ password: '', pin: '' });
  };

  return (
    <>
      <PageHead title="Mon profil" sub={<><Badge tone="blue">{ROLE_LABEL[user!.role]}</Badge> · {phone(user!.phone)}</>} />
      {user!.role === 'vet' && user!.vet && <div className={`banner ${user!.vet.verified ? 'ok' : 'warn'}`}>{user!.vet.verified ? `Numéro d'ordre ${user!.vet.orderNumber} vérifié.` : `Numéro d'ordre ${user!.vet.orderNumber} en attente de vérification par les autorités.`}</div>}
      <div className="grid2">
        <Card title="Informations">
          <form className="form" onSubmit={save}>
            <Field label="Nom" error={errs.name}>{(id) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />}</Field>
            <Field label="Email (facultatif)" error={errs.email}>{(id) => <input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
            <Field label="Zone" error={errs.zoneId}>{(id) => <select id={id} value={zoneId} onChange={(e) => setZoneId(e.target.value)}><option value="">—</option>{zones.data?.items.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select>}</Field>
            <div className="actions end"><button className="btn pri" disabled={busy}>Enregistrer</button></div>
          </form>
        </Card>
        {user!.role === 'particulier' && <BuyerProfileCard />}
        <Card title="Affichage">
          <label className="switch"><input type="checkbox" checked={!!user!.prefs.simple} onChange={(e) => pref({ simple: e.target.checked })} /> <span><b>Mode simple</b><br /><span className="mute">Gros boutons, images, lecture à voix haute, connexion par code à 4 chiffres.</span></span></label>
          <Field label="Thème">{(id) => <select id={id} value={user!.prefs.theme ?? ''} onChange={(e) => pref({ theme: e.target.value || undefined })}><option value="">Automatique</option><option value="light">Clair</option><option value="dark">Sombre</option></select>}</Field>
        </Card>
        <Card title="Code à 4 chiffres">
          <form className="form" onSubmit={savePin}>
            <p className="mute">Pour vous connecter vite sur ce téléphone en mode simple.</p>
            <Field label="Mot de passe actuel">{(id) => <input id={id} type="password" autoComplete="current-password" value={pin.password} onChange={(e) => setPin({ ...pin, password: e.target.value })} required />}</Field>
            <Field label="Nouveau code (4 chiffres)">{(id) => <input id={id} inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={pin.pin} onChange={(e) => setPin({ ...pin, pin: e.target.value.replace(/\D/g, '') })} required />}</Field>
            <div className="actions end"><button className="btn" disabled={busy}>Enregistrer le code</button></div>
          </form>
        </Card>
        <Card title="Mot de passe">
          <form className="form" onSubmit={changePw}>
            <Field label="Mot de passe actuel">{(id) => <input id={id} type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required />}</Field>
            <Field label="Nouveau mot de passe" hint="8 caractères minimum.">{(id) => <input id={id} type="password" autoComplete="new-password" minLength={8} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required />}</Field>
            <div className="actions end"><button className="btn" disabled={busy}>Changer</button></div>
          </form>
        </Card>
      </div>
      <div className="actions"><button className="btn danger" onClick={() => { void logout(); toast('Déconnecté', 'info'); }}>Se déconnecter</button></div>
    </>
  );
}
