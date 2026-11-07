import type { Env, StaffUser } from "./lib";
export type Vars = { user: StaffUser & { perms: string[]; must_change?: boolean }; customerId: number };
export const has = (c: any, perm: string): boolean => (c.get("user").perms as string[]).includes(perm);
export const need = (...perms: string[]) => async (c: any, next: any) => {
  if (!perms.every((p) => has(c, p))) return c.json({ error: "You do not have permission for this action" }, 403);
  await next();
};
export type { Env };
