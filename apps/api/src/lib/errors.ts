/** Erreur métier : renvoyée au client sous la forme { code, message, details? } (contrat d'API). */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const unauthorized = (message = 'Authentification requise.', code = 'unauthorized') => new AppError(401, code, message);
export const forbidden = (message = "Vous n'avez pas le droit de faire cela.", code = 'forbidden') => new AppError(403, code, message);
export const notFound = (message = 'Introuvable.', code = 'not_found') => new AppError(404, code, message);
export const conflict = (code: string, message: string, details?: unknown) => new AppError(409, code, message, details);
export const invalid = (message: string, details?: unknown, code = 'validation_error') => new AppError(422, code, message, details);
export const tooMany = (message: string, details?: unknown, code = 'too_many_requests') => new AppError(429, code, message, details);
