/* ===========================================================================
 * Auth routes: GET /api/setup-status, POST /api/setup, POST /api/login,
 * POST /api/logout, GET /api/me, POST /api/change-password
 * ==========================================================================*/
import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate';
import * as authService from '../services/auth.service';
import * as setupService from '../services/setup.service';
import { requireAuth } from '../middleware/auth';
import { skipCsrf } from '../middleware/csrf';
import { logger } from '../utils/logger';

export const authRouter = Router();

const setupSchema = z.object({
  companyName: z.string().min(1).max(200),
  companyId: z.string().min(1).max(50),
  branchName: z.string().min(1).max(200),
  branchShortName: z.string().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/, 'Branch short name may only contain letters, numbers, underscore and hyphen'),
  fiscalYearName: z.string().min(1).max(50),
  fiscalYearStart: z.string().min(1),
  fiscalYearEnd: z.string().min(1),
  adminUsername: z.string().min(1).max(100),
  adminFullName: z.string().min(1).max(200),
  adminPassword: z.string().min(8).max(128),
});

const loginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(128),
});

const changePwSchema = z.object({
  oldPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

authRouter.get('/setup-status', async (_req, res, next) => {
  try {
    const done = await setupService.isSetupDone();
    res.json({ setupCompleted: done });
  } catch (err) { next(err); }
});

// Real-time company ID uniqueness check. Public (no auth, no CSRF) because
// it runs on the first-time setup form before any session exists.
authRouter.get('/check-company-id', async (req, res, next) => {
  try {
    const companyId = String(req.query.id || '').trim();
    if (!companyId) { res.status(400).json({ error: 'id query parameter is required.' }); return; }
    const taken = await setupService.isCompanyIdTaken(companyId);
    res.json({ companyId, taken });
  } catch (err) { next(err); }
});

authRouter.post('/setup', skipCsrf, validateBody(setupSchema), async (req, res, next) => {
  try {
    if (await setupService.isSetupDone()) {
      res.status(400).json({ error: 'Setup has already been completed.' });
      return;
    }
    await setupService.runSetup(req.body);
    // Auto-login the admin
    const result = await authService.login(req.body.adminUsername, req.body.adminPassword, req.ip || null);
    if (result.ok && result.user) {
      req.session.userId = result.user.id;
    }
    res.json({ ok: true, message: 'Setup complete. You are now signed in.' });
  } catch (err) { next(err); }
});

authRouter.post('/login', skipCsrf, validateBody(loginSchema), async (req, res, next) => {
  try {
    const result = await authService.login(req.body.username, req.body.password, req.ip || null);
    if (!result.ok) {
      res.status(401).json({ error: result.error });
      return;
    }
    req.session.userId = result.user!.id;
    res.json({
      ok: true,
      user: result.user,
      needsPasswordChange: result.needsPasswordChange,
    });
  } catch (err) { next(err); }
});

authRouter.post('/logout', async (req, res, next) => {
  try {
    if (req.user && req.auditCtx) {
      await authService.logout(req.user.id, req.user.username, req.auditCtx.ip);
    }
    req.session.destroy((err) => {
      if (err) {
        logger.error({ err: err.message }, 'Session destroy failed');
      }
      res.clearCookie('erp.sid');
      res.json({ ok: true });
    });
  } catch (err) { next(err); }
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const u = await authService.currentUser(req.user!.id);
    if (!u) {
      req.session.destroy(() => { /* ignore */ });
      res.status(401).json({ error: 'Account no longer exists.' });
      return;
    }
    res.json({ user: { ...u, ...req.user, id: u.id } });
  } catch (err) { next(err); }
});

authRouter.post('/change-password', requireAuth, validateBody(changePwSchema), async (req, res, next) => {
  try {
    const r = await authService.changePassword(req.user!.id, req.body.oldPassword, req.body.newPassword);
    if (!r.ok) {
      res.status(400).json({ error: r.error });
      return;
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});
