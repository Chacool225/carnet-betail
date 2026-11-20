import { useState } from 'react';
import { ApiError, api, cachedGet, downloadCsv, qs } from '../api/client';
import { submitOp } from '../api/offline';
import type { Animal, Page, Species, Zone } from '../api/types';
import { Badge, Card, Empty, ErrorBox, Field, Icon, PageHead, Pager, Spinner, useAction, useQuery, useToast } from '../ui/kit';
import { useAuth } from '../ui/auth';
import { Link, navigate, useLoc } from '../lib/router';
import { DateRange, MoreFilters, ResetFilters, SearchBox, useUrlFilters } from '../ui/filters';
import { EXIT_LABEL, SPECIES, SPECIES_LIST, STATUS, errorText, headcount, date } from '../lib/format';

export function AnimalRow({ a, showOwner }: { a: Animal; showOwner: boolean }) {
  const former = a.relation === 'former';
  return (
    <li>
      <Link to={former ? `/archives/${a.id}` : `/animaux/${a.id}`} className="row">
        <span className="ico" aria-hidden="true">{SPECIES[a.species].icon}</span>
        <div className="grow">
          <b>{a.name}</b> <span className="mono mute">{a.code}</span>
          <br /><span className="mute">{SPECIES[a.species].label}{a.breed ? ` · ${a.breed}` : ''} · {headcount(a)} · {a.zone.name}{showOwner ? ` · ${a.owner.name}` : ''}</span>
          {former && a.exit && <><br /><span className="mute">Sorti du cheptel le {date(a.exit.on)} · dossier archivé</span></>}
        </div>
        {former && a.exit ? <Badge tone="grey">{EXIT_LABEL[a.exit.type]}</Badge> : <Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge>}
      </Link>
    </li>
  );
}

const SORTS: [string, string][] = [
  ['created:desc', 'Plus récents'], ['created:asc', 'Plus anciens'], ['name:asc', 'Nom A → Z'], ['name:desc', 'Nom Z → A'],
  ['born:desc', 'Naissance récente'], ['born:asc', 'Naissance ancienne'], ['species:asc', 'Espèce'], ['updated:desc', 'Modifiés récemment'],
];

export function AnimalsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const { query } = useLoc();
  const picking = query.get('do') === 'maladie';
  const isOwner = user!.role === 'eleveur';
  const f = useUrlFilters({
    q: '', species: '', kind: '', status: isOwner ? 'actif' : '', scope: 'current', sort: 'created:desc',
    createdFrom: '', createdTo: '', bornFrom: '', bornTo: '', exitFrom: '', exitTo: '', withdrawal: '', openCase: '',
  });
  const v = f.values;
  const all = isOwner && v.scope === 'all';
  const [sort, order] = v.sort.split(':');
  const params = {
    q: v.q, species: v.species, kind: v.kind, status: all ? '' : v.status, scope: all ? 'all' : '', sort, order,
    createdFrom: v.createdFrom, createdTo: v.createdTo, bornFrom: v.bornFrom, bornTo: v.bornTo,
    exitFrom: all ? v.exitFrom : '', exitTo: all ? v.exitTo : '', withdrawal: v.withdrawal, openCase: v.openCase,
  };
  const list = useQuery(
    () => cachedGet<Page<Animal>>(`/animals${qs({ ...params, page: f.page, limit: 20 })}`, user!.id),
    [JSON.stringify(params), f.page], { cached: true },
  );
  const advanced = f.active(['q', 'species', 'kind', 'status', 'scope', 'sort']);
  const total = f.active(all ? ['sort', 'scope', 'status'] : ['sort', 'scope']);
  const csv = async () => { try { await downloadCsv('/export/animals.csv', 'animaux.csv'); } catch (e) { toast(errorText(e), 'err'); } };
  const sorts = all ? [...SORTS, ['exit:desc', 'Sortie récente'], ['exit:asc', 'Sortie ancienne']] as [string, string][] : SORTS;

  return (
    <>
      <PageHead title={user!.role === 'vet' ? 'Mes accès' : all ? 'Cheptel complet' : 'Animaux'} sub={list.data ? `${list.data.total} fiche(s)` : undefined}>
        <button className="btn" onClick={csv}><Icon name="download" /> Exporter (CSV)</button>
        {isOwner && <Link to="/animaux/nouveau" className="btn pri"><Icon name="plus" /> Nouvel animal</Link>}
      </PageHead>
      {picking && <div className="banner info" role="status">Choisissez l'animal malade : vous pourrez décrire ce que vous voyez.</div>}
      {isOwner && (
        <div className="seg wide" role="radiogroup" aria-label="Quels animaux afficher" style={{ marginBottom: '.8rem' }}>
          <button type="button" role="radio" aria-selected={!all} onClick={() => f.set({ scope: 'current', exitFrom: '', exitTo: '', status: 'actif' })}>Mon cheptel</button>
          <button type="button" role="radio" aria-selected={all} onClick={() => f.set({ scope: 'all', status: '' })}>Cheptel complet (avec les sortis)</button>
        </div>
      )}
      {all && <div className="banner info" role="status">Les animaux vendus, transférés, abattus ou morts restent consultables : leur dossier est figé à la date de sortie.</div>}
      <div className="filters">
        <SearchBox value={v.q} onChange={(q) => f.set({ q })} placeholder="Nom, code, race, boucle…" />
        <select aria-label="Espèce" value={v.species} onChange={(e) => f.set({ species: e.target.value })}>
          <option value="">Toutes les espèces</option>{SPECIES_LIST.map((s) => <option key={s} value={s}>{SPECIES[s].label}</option>)}
        </select>
        <select aria-label="Type" value={v.kind} onChange={(e) => f.set({ kind: e.target.value })}>
          <option value="">Animaux et lots</option><option value="individual">Animaux seuls</option><option value="lot">Lots</option>
        </select>
        {!all && (
          <select aria-label="Statut" value={v.status} onChange={(e) => f.set({ status: e.target.value })}>
            <option value="">Tous les statuts</option>{Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l.label}</option>)}
          </select>
        )}
        <select aria-label="Trier par" value={v.sort} onChange={(e) => f.set({ sort: e.target.value })}>
          {sorts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      <MoreFilters count={advanced}>
        <DateRange label="Fiche créée" from={v.createdFrom} to={v.createdTo} onChange={(a, b) => f.set({ createdFrom: a, createdTo: b })} />
        <DateRange label="Date de naissance" from={v.bornFrom} to={v.bornTo} onChange={(a, b) => f.set({ bornFrom: a, bornTo: b })} />
        {all && <DateRange label="Date de sortie" from={v.exitFrom} to={v.exitTo} onChange={(a, b) => f.set({ exitFrom: a, exitTo: b })} />}
        {isOwner && (
          <>
            <select aria-label="Délai d'attente" value={v.withdrawal} onChange={(e) => f.set({ withdrawal: e.target.value })}>
              <option value="">Délai d'attente : tous</option><option value="true">En délai d'attente</option><option value="false">Vendables</option>
            </select>
            <select aria-label="Maladie" value={v.openCase} onChange={(e) => f.set({ openCase: e.target.value })}>
              <option value="">Maladie : tous</option><option value="true">Avec un cas ouvert</option><option value="false">Sans cas ouvert</option>
            </select>
          </>
        )}
      </MoreFilters>
      <div className="filterbar"><ResetFilters count={total} onReset={f.reset} /></div>
      {list.stale && <div className="banner off">Liste enregistrée le {date(list.stale)} (hors-ligne).</div>}
      {list.loading && !list.data ? <Spinner /> : list.error && !list.data ? <ErrorBox error={list.error} retry={list.reload} /> : (
        <Card>
          {!list.data?.items.length ? (
            <Empty icon="cow" title="Aucune fiche">{total ? 'Aucun résultat avec ces filtres.' : isOwner ? 'Ajoutez votre premier animal ou lot pour commencer son carnet de santé.' : user!.role === 'vet' ? 'Scannez un animal pour obtenir un accès de 30 jours.' : 'Aucun résultat avec ces filtres.'}</Empty>
          ) : (
            <ul className="rows">{list.data.items.map((a) => <AnimalRow key={a.id} a={a} showOwner={!isOwner || a.relation === 'former'} />)}</ul>
          )}
          {list.data && <Pager page={list.data.page} limit={list.data.limit} total={list.data.total} onPage={f.setPage} />}
        </Card>
      )}
    </>
  );
}

export function NewAnimalPage() {
  const { user } = useAuth();
  const toast = useToast();
  const zones = useQuery(() => cachedGet<{ items: Zone[] }>('/zones', 'public'), [], { cached: true });
  const [f, setF] = useState({ species: 'bovin' as Species, kind: 'individual', name: '', breed: '', sex: '', bornOn: '', qty: '', avgWeightKg: '', rfid: '', zoneId: user!.zone?.id ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  const sp = SPECIES[f.species];
  const kind = sp.single && sp.lot ? f.kind : sp.lot ? 'lot' : 'individual';
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErrors({});
    const p: Record<string, unknown> = { species: f.species, kind, name: f.name.trim() };
    if (f.breed.trim()) p.breed = f.breed.trim();
    if (kind === 'individual' && f.sex) p.sex = f.sex;
    if (f.bornOn) p.bornOn = f.bornOn;
    if (kind === 'lot') p.qty = Number(f.qty);
    if (f.avgWeightKg) p.avgWeightKg = Number(f.avgWeightKg);
    if (kind === 'individual' && f.rfid.trim()) p.rfid = f.rfid.trim().replace(/\s+/g, '');
    if (f.zoneId) p.zoneId = f.zoneId;
    try {
      const r = await run(async () => {
        try { return await submitOp('animal.create', p, `Nouvel ${kind === 'lot' ? 'lot' : 'animal'} : ${f.name.trim()}`); }
        catch (err) {
          if (err instanceof ApiError && err.status === 422 && Array.isArray(err.details)) {
            const m: Record<string, string> = {};
            for (const d of err.details) if (d.path?.[0] && !m[d.path[0]]) m[d.path[0]] = d.message;
            setErrors(m);
          }
          throw err;
        }
      });
      if (!r) return;
      if (r.queued) { toast('Enregistré sur le téléphone : il sera envoyé au retour du réseau.', 'info'); navigate('/envoi'); }
      else { toast('Fiche créée', 'ok'); navigate(`/animaux/${r.result!.id}`); }
    } catch { /* déjà affiché */ }
  };

  return (
    <>
      <PageHead title="Nouvel animal ou lot" sub="Le code QR de la fiche est créé automatiquement." />
      <form className="card form" onSubmit={submit}>
        <Field label="Espèce">{(id) => <select id={id} value={f.species} onChange={(e) => setF((s) => ({ ...s, species: e.target.value as Species }))}>{SPECIES_LIST.map((s) => <option key={s} value={s}>{SPECIES[s].icon} {SPECIES[s].label}</option>)}</select>}</Field>
        {sp.single && sp.lot && (
          <div className="seg" role="radiogroup" aria-label="Type de fiche">
            <button type="button" role="radio" aria-selected={kind === 'individual'} onClick={() => setF((s) => ({ ...s, kind: 'individual' }))}>Animal seul</button>
            <button type="button" role="radio" aria-selected={kind === 'lot'} onClick={() => setF((s) => ({ ...s, kind: 'lot' }))}>Lot</button>
          </div>
        )}
        {!sp.single && <p className="mute">Cette espèce se gère en <b>lot</b> (bande, cage, bassin).</p>}
        {!sp.lot && <p className="mute">Cette espèce se gère <b>animal par animal</b>.</p>}
        <Field label={kind === 'lot' ? 'Nom du lot' : "Nom de l'animal"} error={errors.name}>{(id) => <input id={id} value={f.name} onChange={set('name')} required maxLength={80} placeholder={kind === 'lot' ? 'Bande de poulets n°1' : 'Kouadio'} />}</Field>
        <Field label="Race (facultatif)" error={errors.breed}>{(id) => <input id={id} value={f.breed} onChange={set('breed')} maxLength={80} />}</Field>
        {kind === 'lot' ? (
          <Field label="Effectif" hint="Nombre de têtes aujourd'hui." error={errors.qty}>{(id) => <input id={id} type="number" min={1} value={f.qty} onChange={set('qty')} required inputMode="numeric" />}</Field>
        ) : (
          <>
            <Field label="Sexe" error={errors.sex}>{(id) => <select id={id} value={f.sex} onChange={set('sex')}><option value="">—</option><option value="F">Femelle</option><option value="M">Mâle</option></select>}</Field>
            <Field label="Boucle RFID (facultatif)" hint="10 à 24 caractères, chiffres et lettres A à F." error={errors.rfid}>{(id) => <input id={id} value={f.rfid} onChange={set('rfid')} className="mono" autoCapitalize="characters" />}</Field>
          </>
        )}
        <Field label="Date de naissance (facultatif)" error={errors.bornOn}>{(id) => <input id={id} type="date" value={f.bornOn} max={new Date().toISOString().slice(0, 10)} onChange={set('bornOn')} />}</Field>
        <Field label="Poids moyen en kg (facultatif)" error={errors.avgWeightKg}>{(id) => <input id={id} type="number" step="0.1" min="0" value={f.avgWeightKg} onChange={set('avgWeightKg')} inputMode="decimal" />}</Field>
        <Field label="Zone" error={errors.zoneId}>{(id) => (
          <select id={id} value={f.zoneId} onChange={set('zoneId')} required>
            <option value="">— Choisir —</option>{zones.data?.items.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        )}</Field>
        <div className="actions end">
          <Link to="/animaux" className="btn">Annuler</Link>
          <button className="btn pri" disabled={busy}>{busy ? 'Création…' : 'Créer la fiche'}</button>
        </div>
      </form>
    </>
  );
}
