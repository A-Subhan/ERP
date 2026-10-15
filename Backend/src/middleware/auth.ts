/* ===========================================================================
 * Auth middleware — session-based. Sets req.user to the logged-in user.
 * ==========================================================================*/
import type { Request, Response, NextFunction } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: {
        id: number;
        displayId: string;
        username: string;
        fullName: string;
        isAdmin: boolean;
        allowedBranches: number[] | null;
        allowedStores: number[] | null;
        permissions: Record<string, { view: boolean; add: boolean; edit: boolean; delete: boolean; print: boolean }>;
      };
      auditCtx?: { userId: number | null; userName: string | null; ip: string | null };
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.userId) {
    res.status(401).json({ error: 'You must be signed in to use this area.' });
    return;
  }
  // req.user is populated by the session loader (see sessionLoader.ts)
  if (!req.user) {
    res.status(401).json({ error: 'Session expired. Please sign in again.' });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user?.isAdmin) {
    res.status(403).json({ error: 'This area requires an administrator account.' });
    return;
  }
  next();
}

/** Helper: build a screen permission checker for a specific screen code. */
export function screenPermission(screenCode: string) {
  return {
    view:   (req: Request) => req.user?.isAdmin === true || !!req.user?.permissions?.[screenCode]?.view,
    add:    (req: Request) => req.user?.isAdmin === true || !!req.user?.permissions?.[screenCode]?.add,
    edit:   (req: Request) => req.user?.isAdmin === true || !!req.user?.permissions?.[screenCode]?.edit,
    del:    (req: Request) => req.user?.isAdmin === true || !!req.user?.permissions?.[screenCode]?.delete,
    print:  (req: Request) => req.user?.isAdmin === true || !!req.user?.permissions?.[screenCode]?.print,
  };
}

/** Middleware factory: require a specific permission flag on a screen. */
export function requirePermission(screenCode: string, flag: 'view' | 'add' | 'edit' | 'del' | 'print') {
  const checker = screenPermission(screenCode);
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Session expired.' });
      return;
    }
    const map = { view: checker.view, add: checker.add, edit: checker.edit, del: checker.del, print: checker.print };
    if (!map[flag](req)) {
      res.status(403).json({ error: `You do not have ${flag.toUpperCase()} permission on this screen.` });
      return;
    }
    next();
  };
}

/** Check branch/store restriction for the current user. */
export function userCanAccessBranch(req: Request, branchId: number): boolean {
  if (req.user?.isAdmin) return true;
  if (!req.user?.allowedBranches) return true;
  return req.user.allowedBranches.includes(branchId);
}

export function userCanAccessStore(req: Request, storeId: number): boolean {
  if (req.user?.isAdmin) return true;
  if (!req.user?.allowedStores) return true;
  return req.user.allowedStores.includes(storeId);
}
