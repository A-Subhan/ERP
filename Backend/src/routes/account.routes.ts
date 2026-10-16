/* ===========================================================================
 * Chart of Accounts routes — uses code as PK.
 * ==========================================================================*/
import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate';
import { requireAuth, requirePermission } from '../middleware/auth';
import * as accountService from '../services/account.service';
import * as detailsService from '../services/accountDetails.service';

export const accountRouter = Router();
accountRouter.use(requireAuth);

const createSchema = z.object({
  parentCode: z.string().max(40).nullable().optional(),
  name: z.string().min(1).max(200),
  nature: z.enum(['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE']),
  isGroup: z.boolean(),
  isCash: z.boolean().optional(),
  isBank: z.boolean().optional(),
  partyType: z.enum(['NONE','CUSTOMER','SUPPLIER']).optional(),
});

const updateSchema = createSchema.partial().omit({ nature: true, isGroup: true, parentCode: true });

accountRouter.get('/', requirePermission('chart_of_accounts', 'view'), async (_req, res, next) => {
  try { res.json(await accountService.listAccounts()); }
  catch (err) { next(err); }
});

accountRouter.get('/:code', requirePermission('chart_of_accounts', 'view'), async (req, res, next) => {
  try {
    const a = await accountService.getAccountByCode(req.params.code);
    if (!a) { res.status(404).json({ error: 'Account not found.' }); return; }
    res.json(a);
  } catch (err) { next(err); }
});

accountRouter.post('/', requirePermission('chart_of_accounts', 'add'), validateBody(createSchema), async (req, res, next) => {
  try { res.status(201).json(await accountService.createAccount(req.body, req.auditCtx!)); }
  catch (err) { next(err); }
});

accountRouter.put('/:code', requirePermission('chart_of_accounts', 'edit'), validateBody(updateSchema), async (req, res, next) => {
  try { res.json(await accountService.updateAccount(req.params.code, req.body, req.auditCtx!)); }
  catch (err) { next(err); }
});

accountRouter.delete('/:code', requirePermission('chart_of_accounts', 'del'), async (req, res, next) => {
  try {
    await accountService.deleteAccount(req.params.code, req.auditCtx!);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Account details
accountRouter.get('/:code/details', requirePermission('chart_of_accounts', 'view'), async (req, res, next) => {
  try {
    const d = await detailsService.getDetails(req.params.code);
    const tags = await detailsService.getBranchTags(req.params.code);
    res.json({ details: d, branchTags: tags });
  } catch (err) { next(err); }
});

accountRouter.put('/:code/details', requirePermission('chart_of_accounts', 'edit'), async (req, res, next) => {
  try {
    // Accept partial details object + branchTags
    const { branchTags, ...detailsFields } = req.body;
    const updated = await detailsService.upsertDetails(req.params.code, detailsFields, req.auditCtx!);
    if (Array.isArray(branchTags)) {
      await detailsService.setBranchTags(req.params.code, branchTags, req.auditCtx!);
    }
    res.json(updated);
  } catch (err) { next(err); }
});

// Branch tags separately
accountRouter.put('/:code/branch-tags', requirePermission('chart_of_accounts', 'edit'), async (req, res, next) => {
  try {
    const ids: number[] = Array.isArray(req.body.branchIds) ? req.body.branchIds : [];
    await detailsService.setBranchTags(req.params.code, ids, req.auditCtx!);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Photo upload — multipart/form-data via multer
// Accepts jpg, png, webp up to 3 MB. Stored on disk under
// uploads/account_photos/<code>_<field>_<timestamp>.<ext>
// Served via GET /:code/photo/:field (authenticated, requires view perm).
// ---------------------------------------------------------------------------
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'account_photos');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 3 * 1024 * 1024;  // 3 MB

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const code = (req as any).params.code as string;
    const field = (req as any).params.field as string;
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const filename = `${code}_${field}_${Date.now()}${ext}`;
    cb(null, filename);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPG, PNG and WebP files are accepted.'));
  },
});

const PHOTO_FIELDS = ['nicPhotoPath', 'personPhotoPath', 'photo1Path', 'photo2Path'] as const;
type PhotoField = typeof PHOTO_FIELDS[number];

accountRouter.post('/:code/photo/:field', requirePermission('chart_of_accounts', 'edit'), async (req, res, next) => {
  try {
    const field = req.params.field as PhotoField;
    if (!PHOTO_FIELDS.includes(field)) {
      res.status(400).json({ error: 'Invalid photo field. Must be one of: nicPhotoPath, personPhotoPath, photo1Path, photo2Path.' });
      return;
    }
    // multer needs to run as middleware; use a wrapper
    upload.single('file')(req, res, async (err: any) => {
      if (err) {
        res.status(400).json({ error: err.message || 'Photo upload failed.' });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded. Use field name "file".' });
        return;
      }
      const relativePath = path.relative(process.cwd(), req.file.path).replace(/\\/g, '/');
      const label = (req.body.label as string | undefined) ?? null;
      await detailsService.setPhoto(req.params.code, field, relativePath, label, req.auditCtx!);
      res.json({ ok: true, path: relativePath, filename: req.file.filename, size: req.file.size });
    });
  } catch (err) { next(err); }
});

accountRouter.delete('/:code/photo/:field', requirePermission('chart_of_accounts', 'edit'), async (req, res, next) => {
  try {
    const field = req.params.field as PhotoField;
    if (!PHOTO_FIELDS.includes(field)) {
      res.status(400).json({ error: 'Invalid photo field.' });
      return;
    }
    // Read current path to delete the file from disk
    const current = await detailsService.getDetails(req.params.code);
    const currentPath = current ? (current as any)[field] as string | null : null;
    if (currentPath) {
      const abs = path.resolve(process.cwd(), currentPath);
      if (fs.existsSync(abs)) {
        try { fs.unlinkSync(abs); } catch (_) { /* ignore */ }
      }
    }
    await detailsService.setPhoto(req.params.code, field, null, null, req.auditCtx!);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Serve a photo (authenticated, requires view perm)
accountRouter.get('/:code/photo/:field', requirePermission('chart_of_accounts', 'view'), async (req, res, next) => {
  try {
    const field = req.params.field as PhotoField;
    if (!PHOTO_FIELDS.includes(field)) { res.status(400).json({ error: 'Invalid photo field.' }); return; }
    const d = await detailsService.getDetails(req.params.code);
    if (!d) { res.status(404).json({ error: 'No details for this account.' }); return; }
    const relPath = (d as any)[field] as string | null;
    if (!relPath) { res.status(404).json({ error: 'No photo stored for this field.' }); return; }
    const abs = path.resolve(process.cwd(), relPath);
    if (!fs.existsSync(abs)) { res.status(404).json({ error: 'Photo file missing from disk.' }); return; }
    res.sendFile(abs);
  } catch (err) { next(err); }
});
