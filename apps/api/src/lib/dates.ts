/** Les colonnes DATE sortent en AAAA-MM-JJ (texte) avec pg, mais peuvent sortir en Date avec PGlite : on uniformise. */
export const dateStr = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

export const todayStr = (): string => new Date().toISOString().slice(0, 10);
