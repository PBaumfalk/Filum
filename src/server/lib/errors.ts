/** Fehler mit HTTP-Status und verständlicher Meldung für Oberfläche und API. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public field?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Eintrag') => new AppError(404, 'not_found', `${what} nicht gefunden.`);
export const forbidden = (msg = 'Dafür fehlt Ihnen die Berechtigung.') => new AppError(403, 'forbidden', msg);
export const conflict = (msg: string, field?: string) => new AppError(409, 'conflict', msg, field);
export const badRequest = (msg: string, field?: string) => new AppError(400, 'invalid', msg, field);
