import type { Db } from '../db/index.js';

/**
 * Crée une notification pour chaque vaccin ou soin à refaire dans les 3 jours (ou en retard) sur un animal actif.
 * Une seule notification par acte et par état (« bientôt » puis « en retard »), grâce à la clé de dédoublonnage.
 * Reprend la règle de GET /reminders : seul le dernier acte de chaque libellé compte, et un acte corrigé est ignoré.
 */
export async function createReminderNotifications(db: Db): Promise<number> {
  const rows = await db.query(
    `INSERT INTO notifications (user_id, kind, title, body, link, dedupe_key)
     WITH last AS (
       SELECT DISTINCT ON (e.animal_id, e.label) e.id, e.animal_id, e.label, e.next_due_on
       FROM health_events e JOIN animals a ON a.id = e.animal_id
       WHERE a.status = 'actif' AND NOT EXISTS (SELECT 1 FROM health_events c WHERE c.corrects_event_id = e.id)
       ORDER BY e.animal_id, e.label, e.done_on DESC, e.created_at DESC
     )
     SELECT a.owner_id, 'reminder',
            CASE WHEN l.next_due_on < current_date THEN 'En retard : ' ELSE 'À faire bientôt : ' END || l.label,
            a.name || ' · prévu le ' || to_char(l.next_due_on, 'DD/MM/YYYY'),
            '/animaux/' || a.id,
            'reminder:' || l.id || ':' || CASE WHEN l.next_due_on < current_date THEN 'late' ELSE 'soon' END
     FROM last l JOIN animals a ON a.id = l.animal_id
     WHERE l.next_due_on IS NOT NULL AND l.next_due_on <= current_date + 3
     ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
     RETURNING id`,
  );
  return rows.length;
}

/** Au démarrage puis toutes les 6 heures ; renvoie la fonction d'arrêt. */
export function scheduleReminders(db: Db, log: (msg: string) => void, everyMs = 6 * 3_600_000): () => void {
  const run = () => createReminderNotifications(db).then((n) => n && log(`rappels : ${n} notification(s)`)).catch((e) => log(`rappels en échec : ${String(e)}`));
  void run();
  const timer = setInterval(run, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
