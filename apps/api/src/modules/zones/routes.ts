import type { FastifyInstance } from 'fastify';

export async function zoneRoutes(app: FastifyInstance): Promise<void> {
  /** Liste publique : nécessaire à l'inscription, avant toute connexion. */
  app.get('/zones', async () => {
    const rows = await app.db.query('SELECT id, name, lat, lng FROM zones ORDER BY name');
    return { items: rows.map((r) => ({ id: r.id, name: r.name, lat: r.lat, lng: r.lng })) };
  });
}
