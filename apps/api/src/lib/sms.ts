/**
 * Envoi de SMS. Aucun fournisseur n'est imposé : si SMS_WEBHOOK_URL est défini, le message est envoyé
 * en POST JSON { to, text } à cette adresse (à relier à Orange, MTN, Twilio, etc.). Sinon il est seulement
 * écrit dans les journaux du serveur, ce qui suffit en développement mais PAS en production.
 */
type Sender = (to: string, text: string) => Promise<void>;
let override: Sender | null = null;
/** Pour les tests : remplace l'envoi réel. */
export const setSmsSender = (fn: Sender | null): void => { override = fn; };

export async function sendSms(webhookUrl: string | undefined, to: string, text: string, log: (m: string) => void = console.log): Promise<void> {
  if (override) return override(to, text);
  if (!webhookUrl) { log(`[SMS non envoyé : SMS_WEBHOOK_URL absent] à ${to} : ${text}`); return; }
  const res = await fetch(webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to, text }), signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`SMS refusé par le fournisseur (${res.status})`);
}
