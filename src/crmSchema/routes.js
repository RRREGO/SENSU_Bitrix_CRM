/**
 * RBAC-protected CRM schema registry API (read-only + admin capture).
 */

import express from "express";
import {
  requireAuthentication,
  requirePermissionMiddleware,
} from "../auth/middleware.js";
import { AuthError } from "../auth/config.js";
import { redactObject } from "../safety/redact.js";
import * as repo from "../database/repositories/crmSchemaRepository.js";
import {
  capturePortalSchema,
  importAllSeedConfigs,
  getLatestSnapshot,
} from "./snapshotService.js";
import { compareSnapshots } from "./diffService.js";
import { explainStage } from "./processKnowledgeService.js";

export function createCrmSchemaRouter() {
  const router = express.Router();
  const auth = requireAuthentication();
  const canRead = [auth, requirePermissionMiddleware("crm.schema.read")];
  const canCapture = [auth, requirePermissionMiddleware("crm.schema.capture")];

  router.get("/api/crm-schema/portals", ...canRead, (_req, res) => {
    res.json({
      success: true,
      portals: repo.listPortalKeys(),
    });
  });

  router.get("/api/crm-schema/snapshots", ...canRead, (req, res) => {
    const snapshots = repo.listSnapshots({
      portalKey: req.query.portalKey || undefined,
      sourceType: req.query.sourceType || undefined,
      status: req.query.status || undefined,
      limit: req.query.limit || 100,
    });
    res.json({
      success: true,
      snapshots: snapshots.map((s) => redactObject(s)),
    });
  });

  router.get("/api/crm-schema/entities", ...canRead, (req, res) => {
    const snapshotId =
      req.query.snapshotId ||
      (req.query.portalKey
        ? getLatestSnapshot(String(req.query.portalKey))?.id
        : null);
    if (!snapshotId) {
      return res.status(400).json({
        success: false,
        error: {
          code: "SNAPSHOT_REQUIRED",
          message: "Укажите snapshotId или portalKey с существующим snapshot.",
        },
      });
    }
    const fields = repo.listFields({
      snapshotId,
      entityType: req.query.entityType || undefined,
    });
    const withEnums = fields.map((f) => ({
      ...f,
      enums: repo.listEnumsForField(f.id),
    }));
    res.json({
      success: true,
      snapshotId,
      entities: withEnums,
    });
  });

  router.get("/api/crm-schema/pipelines", ...canRead, (req, res) => {
    const snapshotId =
      req.query.snapshotId ||
      (req.query.portalKey
        ? getLatestSnapshot(String(req.query.portalKey))?.id
        : null);
    const pipelines = repo.listPipelines({
      snapshotId: snapshotId || undefined,
      portalKey: req.query.portalKey || undefined,
      entityType: req.query.entityType || undefined,
    });
    res.json({ success: true, pipelines });
  });

  router.get("/api/crm-schema/stages", ...canRead, (req, res) => {
    const stages = repo.listStages({
      snapshotId: req.query.snapshotId || undefined,
      portalKey: req.query.portalKey || undefined,
      entityType: req.query.entityType || undefined,
      stageId: req.query.stageId || undefined,
      canonicalStage: req.query.canonicalStage || undefined,
    });
    res.json({ success: true, stages });
  });

  router.get("/api/crm-schema/diff", ...canRead, (req, res) => {
    try {
      const baseId = req.query.baseSnapshotId;
      const targetId = req.query.targetSnapshotId;
      if (!baseId || !targetId) {
        return res.status(400).json({
          success: false,
          error: {
            code: "DIFF_PARAMS_REQUIRED",
            message: "Нужны baseSnapshotId и targetSnapshotId.",
          },
        });
      }
      const diff = compareSnapshots(String(baseId), String(targetId));
      res.json({ success: true, diff: redactObject(diff) });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: { code: "DIFF_FAILED", message: error.message },
      });
    }
  });

  router.get("/api/crm-schema/stage-explanation", ...canRead, (req, res) => {
    const portalKey = req.query.portalKey;
    const entityType = req.query.entityType;
    const stageId = req.query.stageId;
    if (!portalKey || !entityType || !stageId) {
      return res.status(400).json({
        success: false,
        error: {
          code: "EXPLANATION_PARAMS_REQUIRED",
          message: "Нужны portalKey, entityType, stageId.",
        },
      });
    }
    const explanation = explainStage(
      String(portalKey),
      String(entityType),
      req.query.categoryId ?? "0",
      String(stageId)
    );
    res.json({ success: true, ...redactObject(explanation) });
  });

  /**
   * Admin-only: read Bitrix metadata and store local snapshot. No Bitrix writes.
   */
  router.post("/api/crm-schema/snapshots/capture", ...canCapture, async (req, res) => {
    try {
      const portalKey = String(req.body?.portalKey || req.query.portalKey || "sensu");
      const result = await capturePortalSchema(portalKey);
      res.json({
        success: true,
        created: result.created,
        snapshot: redactObject(result.snapshot),
        contentHash: result.contentHash,
        warnings: result.warnings,
        meta: redactObject(result.meta),
        note: "Только чтение Bitrix REST + локальное сохранение snapshot. Запись в Bitrix не выполнялась.",
      });
    } catch (error) {
      if (error instanceof AuthError) {
        return res.status(403).json(error.toJSON());
      }
      res.status(500).json({
        success: false,
        error: {
          code: "CAPTURE_FAILED",
          message: error.message,
        },
      });
    }
  });

  /** Optional helper: re-import seed configs (admin). */
  router.post("/api/crm-schema/seeds/import", ...canCapture, (req, res) => {
    try {
      const results = importAllSeedConfigs({
        forceNew: Boolean(req.body?.forceNew),
      });
      res.json({ success: true, results: redactObject(results) });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: "SEED_IMPORT_FAILED", message: error.message },
      });
    }
  });

  return router;
}

export default createCrmSchemaRouter;
