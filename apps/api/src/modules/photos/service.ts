import type { Db } from '../../db/index.js';
import { conflict, invalid, notFound } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import type { AuthContext } from '../../plugins/auth.js';
import { loadVisible } from '../animals/service.js';
import { MAX_PHOTOS } from '../animals/schemas.js';

export const MAX_PHOTO_BYTES = 1_500_000;
const MAGIC: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8,
  'image/png': (b) => b.subarray(0, 4).toString('hex') === '89504e47',
  'image/webp': (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP',
};

/** Enregistre une photo envoyée depuis le téléphone (déjà réduite par l'application). Le contenu est vérifié, pas seulement l'étiquette. */
export async function uploadPhoto(db: Db, auth: AuthContext, animalId: string, contentType: string, dataB64: string) {
  const buf = Buffer.from(dataB64, 'base64');
  if (!buf.length) throw invalid('Photo vide.', [{ path: ['data'], message: 'Photo vide.' }]);
  if (buf.length > MAX_PHOTO_BYTES) throw invalid('Photo trop lourde (1,5 Mo au maximum).', [{ path: ['data'], message: 'Trop lourde.' }]);
  if (!MAGIC[contentType]?.(buf)) throw invalid("Ce fichier n'est pas une image JPEG, PNG ou WebP valide.", [{ path: ['data'], message: 'Image invalide.' }]);
  return db.tx(async (q) => {
    const { row, level } = await loadVisible(q, auth, animalId, true);
    if (level !== 'owner' || row.status !== 'actif') throw conflict('photo_forbidden', "Seul le propriétaire d'un animal actif peut ajouter une photo.");
    const n = (await q.query<{ n: number }>('SELECT count(*)::int AS n FROM animal_photos WHERE animal_id = $1', [animalId]))[0]!.n;
    if (n >= MAX_PHOTOS) throw conflict('photo_limit', 'Dix photos au maximum par fiche.');
    const id = (await q.query<{ id: string }>("INSERT INTO animal_photos (animal_id, url) VALUES ($1, 'pending') RETURNING id", [animalId]))[0]!.id;
    const url = `/photos/${id}/file`;
    await q.query('UPDATE animal_photos SET url = $2 WHERE id = $1', [id, url]);
    await q.query('INSERT INTO photo_files (photo_id, content_type, data_b64) VALUES ($1,$2,$3)', [id, contentType, buf.toString('base64')]);
    if (!row.photo_url) await q.query('UPDATE animals SET photo_url = $2, updated_at = now() WHERE id = $1', [animalId, url]);
    await writeAudit(q, { actorId: auth.userId, animalId, action: 'animal.photo_added', detail: { upload: true } });
    return { id, url };
  });
}

/** Lecture publique : l'identifiant de la photo est un UUID aléatoire, et les photos d'annonces sont faites pour être vues. */
export async function photoFile(db: Db, photoId: string): Promise<{ contentType: string; data: Buffer }> {
  const r = (await db.query('SELECT content_type, data_b64 FROM photo_files WHERE photo_id = $1', [photoId]))[0];
  if (!r) throw notFound('Photo introuvable.');
  return { contentType: r.content_type as string, data: Buffer.from(r.data_b64 as string, 'base64') };
}
