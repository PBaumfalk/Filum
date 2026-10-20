import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, forbidden } from '../lib/errors.js';
import { hasRole, type UserRow } from '../services/auth.js';
import type { Principal, Role } from '../services/links.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** „METHODE /pfad“ aller registrierten Routen */
    registeredRoutes: string[];
  }
  interface FastifyRequest {
    user: UserRow | null;
    principal: Principal | null;
    sessionToken: string | null;
    sessionHash: string | null;
  }
}

export type Req = FastifyRequest;
export type Rep = FastifyReply;

/** Verlangt eine Anmeldung und mindestens die angegebene Rolle bzw. Token-Stufe. */
export function need(req: FastifyRequest, minRole: Role = 'viewer', scope: 'read' | 'write' | 'admin' = 'read'): Principal {
  const p = req.principal;
  if (!p) throw new AppError(401, 'unauthenticated', 'Bitte melden Sie sich an.');
  if (!hasRole(p.role, minRole)) {
    const names: Record<Role, string> = { viewer: 'Ansehen', member: 'Mitglied', editor: 'Redaktion', admin: 'Admin' };
    throw forbidden(`Dafür ist mindestens die Rolle „${names[minRole]}“ nötig.`);
  }
  if (p.scope) {
    const rank = { read: 0, write: 1, admin: 2 };
    if (rank[p.scope] < rank[scope]) throw forbidden(`Dieses API-Token hat nur die Stufe „${p.scope}“; nötig ist „${scope}“.`);
  }
  return p;
}

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  return schema.parse(data ?? {});
}

export const idParam = z.object({ id: z.coerce.number().int().positive() });

export function intQuery(v: unknown): number | undefined {
  if (v === undefined || v === '' || v === null) return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}
