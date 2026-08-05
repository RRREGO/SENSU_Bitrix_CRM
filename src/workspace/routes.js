import express from "express";
import { WorkspaceError } from "../workspace/config.js";
import { searchWorkspace } from "../workspace/searchService.js";
import {
  listProfiles,
  getProfileById,
  createProfile,
  updateProfile,
  activateProfile,
  getActiveProfile,
} from "../database/repositories/profilesRepository.js";
import {
  listProjects,
  getProjectById,
  createProject,
  updateProject,
  archiveProject,
  restoreProject,
  deleteProjectPermanently,
  duplicateProject,
} from "../database/repositories/projectsRepository.js";
import {
  listProjectFiles,
  addProjectFile,
  deleteProjectFile,
} from "../database/repositories/projectFilesRepository.js";
import {
  listChats,
  getChatById,
  createChat,
  updateChat,
  archiveChat,
  restoreChat,
  deleteChatPermanently,
  duplicateChat,
} from "../database/repositories/chatsRepository.js";
import { listMessages } from "../database/repositories/messagesRepository.js";
import { listSettings, getSetting, setSetting } from "../database/repositories/settingsRepository.js";
import { AuthError } from "../auth/config.js";
import {
  authorizeChatAccess,
  authorizeProjectAccess,
  filterChatsForUser,
  filterProjectsForUser,
} from "../auth/resourceOwnership.js";

function sendError(res, error, fallbackStatus = 400) {
  if (error instanceof AuthError) {
    return res.status(403).json(error.toJSON());
  }
  if (error instanceof WorkspaceError) {
    return res.status(fallbackStatus).json(error.toJSON());
  }
  return res.status(500).json({
    success: false,
    error: { code: "DATABASE_WRITE_FAILED", message: error.message },
  });
}

export function createWorkspaceRouter() {
  const router = express.Router();

  // --- Profiles ---
  router.get("/profiles", (_req, res) => {
    res.json({ success: true, profiles: listProfiles(), active: getActiveProfile() });
  });

  router.post("/profiles", (req, res) => {
    try {
      const profile = createProfile(req.body || {});
      res.json({ success: true, profile });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/profiles/:id", (req, res, next) => {
    // Reserved path handled by connections router (GET /profiles/variables).
    if (req.params.id === "variables") return next("router");

    const profile = getProfileById(req.params.id);
    if (!profile) {
      return res.status(404).json({
        success: false,
        error: { code: "PROFILE_NOT_FOUND", message: "Профиль не найден." },
      });
    }
    res.json({ success: true, profile });
  });

  router.patch("/profiles/:id", (req, res) => {
    try {
      const profile = updateProfile(req.params.id, req.body || {});
      res.json({ success: true, profile });
    } catch (error) {
      sendError(res, error, error.code === "PROFILE_NOT_FOUND" ? 404 : 400);
    }
  });

  router.post("/profiles/:id/activate", (req, res) => {
    try {
      const profile = activateProfile(req.params.id);
      res.json({ success: true, profile });
    } catch (error) {
      sendError(res, error, error.code === "PROFILE_NOT_FOUND" ? 404 : 400);
    }
  });

  // --- Projects ---
  router.get("/projects", (req, res) => {
    const archived = req.query.archived === "true";
    res.json({
      success: true,
      projects: filterProjectsForUser(listProjects({ archived }), req.user),
    });
  });

  router.post("/projects", (req, res) => {
    try {
      const userId = req.user?.userId ?? null;
      const project = createProject({
        ...(req.body || {}),
        ownerUserId: userId,
        createdByUserId: userId,
      });
      res.json({ success: true, project });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/projects/:id", (req, res) => {
    try {
      const project = getProjectById(req.params.id);
      if (!project) {
        return res.status(404).json({
          success: false,
          error: { code: "PROJECT_NOT_FOUND", message: "Проект не найден." },
        });
      }
      authorizeProjectAccess(req.user, project);
      res.json({
        success: true,
        project,
        files: listProjectFiles(project.id),
        chats: filterChatsForUser(
          listChats({ projectId: project.id, limit: 50 }),
          req.user
        ),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.patch("/projects/:id", (req, res) => {
    try {
      const project = getProjectById(req.params.id);
      if (!project) {
        return res.status(404).json({
          success: false,
          error: { code: "PROJECT_NOT_FOUND", message: "Проект не найден." },
        });
      }
      authorizeProjectAccess(req.user, project, { write: true });
      const updated = updateProject(req.params.id, req.body || {});
      res.json({ success: true, project: updated });
    } catch (error) {
      sendError(res, error, error.code === "PROJECT_NOT_FOUND" ? 404 : 400);
    }
  });

  router.post("/projects/:id/archive", (req, res) => {
    try {
      const project = getProjectById(req.params.id);
      if (!project) {
        return res.status(404).json({
          success: false,
          error: { code: "PROJECT_NOT_FOUND", message: "Проект не найден." },
        });
      }
      authorizeProjectAccess(req.user, project, { manage: true });
      const archived = archiveProject(req.params.id);
      res.json({ success: true, project: archived });
    } catch (error) {
      sendError(res, error, error.code === "PROJECT_NOT_FOUND" ? 404 : 400);
    }
  });

  router.post("/projects/:id/restore", (req, res) => {
    try {
      const project = getProjectById(req.params.id);
      if (!project) {
        return res.status(404).json({
          success: false,
          error: { code: "PROJECT_NOT_FOUND", message: "Проект не найден." },
        });
      }
      authorizeProjectAccess(req.user, project, { manage: true });
      const restored = restoreProject(req.params.id);
      res.json({ success: true, project: restored });
    } catch (error) {
      sendError(res, error, error.code === "PROJECT_NOT_FOUND" ? 404 : 400);
    }
  });

  router.post("/projects/:id/duplicate", (req, res) => {
    try {
      const project = getProjectById(req.params.id);
      if (!project) {
        return res.status(404).json({
          success: false,
          error: { code: "PROJECT_NOT_FOUND", message: "Проект не найден." },
        });
      }
      authorizeProjectAccess(req.user, project);
      const userId = req.user?.userId ?? null;
      const copy = duplicateProject(req.params.id, {
        ownerUserId: userId,
        createdByUserId: userId,
      });
      res.json({ success: true, project: copy });
    } catch (error) {
      sendError(res, error, error.code === "PROJECT_NOT_FOUND" ? 404 : 400);
    }
  });

  router.delete("/projects/:id", (req, res) => {
    try {
      const project = getProjectById(req.params.id);
      if (!project) {
        return res.status(404).json({
          success: false,
          error: { code: "PROJECT_NOT_FOUND", message: "Проект не найден." },
        });
      }
      authorizeProjectAccess(req.user, project, { manage: true });
      const permanent =
        req.query.permanent === "1" ||
        req.query.permanent === "true" ||
        req.body?.permanent === true;
      if (permanent) {
        const result = deleteProjectPermanently(req.params.id);
        return res.json({ success: true, ...result });
      }
      const archived = archiveProject(req.params.id);
      res.json({ success: true, project: archived });
    } catch (error) {
      sendError(res, error, error.code === "PROJECT_NOT_FOUND" ? 404 : 400);
    }
  });

  router.get("/projects/:id/files", (req, res) => {
    try {
      const project = getProjectById(req.params.id);
      if (!project) {
        return res.status(404).json({
          success: false,
          error: { code: "PROJECT_NOT_FOUND", message: "Проект не найден." },
        });
      }
      authorizeProjectAccess(req.user, project);
      const files = listProjectFiles(req.params.id).map((f) => ({
        id: f.id,
        projectId: f.projectId,
        filename: f.filename,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        contentHash: f.contentHash,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
      }));
      res.json({ success: true, files });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/projects/:id/files", (req, res) => {
    try {
      const project = getProjectById(req.params.id);
      if (!project) {
        return res.status(404).json({
          success: false,
          error: { code: "PROJECT_NOT_FOUND", message: "Проект не найден." },
        });
      }
      authorizeProjectAccess(req.user, project, { write: true });
      const file = addProjectFile(req.params.id, {
        filename: req.body?.filename,
        mimeType: req.body?.mimeType,
        contentText: req.body?.contentText ?? req.body?.content,
      });
      res.json({
        success: true,
        file: {
          id: file.id,
          filename: file.filename,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          contentHash: file.contentHash,
          createdAt: file.createdAt,
        },
      });
    } catch (error) {
      sendError(res, error, error.code === "PROJECT_NOT_FOUND" ? 404 : 400);
    }
  });

  router.delete("/projects/:id/files/:fileId", (req, res) => {
    try {
      const project = getProjectById(req.params.id);
      if (!project) {
        return res.status(404).json({
          success: false,
          error: { code: "PROJECT_NOT_FOUND", message: "Проект не найден." },
        });
      }
      authorizeProjectAccess(req.user, project, { write: true });
      const result = deleteProjectFile(req.params.id, req.params.fileId);
      res.json(result);
    } catch (error) {
      sendError(res, error, 404);
    }
  });

  // --- Chats ---
  router.get("/chats", (req, res) => {
    const chats = filterChatsForUser(
      listChats({
        projectId: req.query.projectId,
        status: req.query.status,
        limit: req.query.limit,
        offset: req.query.offset,
        includeArchived: req.query.status === "archived",
        unassigned: req.query.unassigned,
        sort: req.query.sort,
        q: req.query.q || req.query.query,
      }),
      req.user
    );
    res.json({ success: true, chats });
  });

  router.post("/chats", (req, res) => {
    try {
      const userId = req.user?.userId ?? null;
      const chat = createChat({
        title: req.body?.title || null,
        projectId: req.body?.projectId || null,
        crmEntityType: req.body?.crmEntityType || null,
        crmEntityId: req.body?.crmEntityId || null,
        sessionId: req.body?.sessionId || null,
        ownerUserId: userId,
        createdByUserId: userId,
      });
      res.json({ success: true, chat });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/chats/:id", (req, res) => {
    try {
      const chat = getChatById(req.params.id);
      if (!chat) {
        return res.status(404).json({
          success: false,
          error: { code: "CHAT_NOT_FOUND", message: "Чат не найден." },
        });
      }
      authorizeChatAccess(req.user, chat);
      res.json({ success: true, chat });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/chats/:id/messages", (req, res) => {
    try {
      const chat = getChatById(req.params.id);
      if (!chat) {
        return res.status(404).json({
          success: false,
          error: { code: "CHAT_NOT_FOUND", message: "Чат не найден." },
        });
      }
      authorizeChatAccess(req.user, chat);
      const messages = listMessages(req.params.id, {
        beforeId: req.query.beforeId,
        limit: req.query.limit,
      });
      res.json({ success: true, messages });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.patch("/chats/:id", (req, res) => {
    try {
      const chat = getChatById(req.params.id);
      if (!chat) {
        return res.status(404).json({
          success: false,
          error: { code: "CHAT_NOT_FOUND", message: "Чат не найден." },
        });
      }
      authorizeChatAccess(req.user, chat, { write: true });
      const updated = updateChat(req.params.id, {
        title: req.body?.title,
        projectId: req.body?.projectId,
        crmEntityType: req.body?.crmEntityType,
        crmEntityId: req.body?.crmEntityId,
        status: req.body?.status,
        isPinned: req.body?.isPinned,
        ...(req.body?.aiModelId !== undefined ? { aiModelId: req.body.aiModelId } : {}),
        ...(req.body?.modelName !== undefined ? { modelName: req.body.modelName } : {}),
        ...(req.body?.aiProviderId !== undefined ? { aiProviderId: req.body.aiProviderId } : {}),
        ...(req.body?.promptProfileId !== undefined ? { promptProfileId: req.body.promptProfileId } : {}),
      });
      res.json({ success: true, chat: updated });
    } catch (error) {
      sendError(res, error, error.code === "CHAT_NOT_FOUND" ? 404 : 400);
    }
  });

  router.delete("/chats/:id", (req, res) => {
    try {
      const chat = getChatById(req.params.id);
      if (!chat) {
        return res.status(404).json({
          success: false,
          error: { code: "CHAT_NOT_FOUND", message: "Чат не найден." },
        });
      }
      authorizeChatAccess(req.user, chat, { write: true });
      const permanent =
        req.query.permanent === "1" ||
        req.query.permanent === "true" ||
        req.body?.permanent === true;
      if (permanent) {
        const result = deleteChatPermanently(req.params.id);
        return res.json({ success: true, ...result });
      }
      const archived = archiveChat(req.params.id);
      res.json({ success: true, chat: archived });
    } catch (error) {
      sendError(res, error, 404);
    }
  });

  router.post("/chats/:id/restore", (req, res) => {
    try {
      const chat = getChatById(req.params.id);
      if (!chat) {
        return res.status(404).json({
          success: false,
          error: { code: "CHAT_NOT_FOUND", message: "Чат не найден." },
        });
      }
      authorizeChatAccess(req.user, chat, { write: true });
      const restored = restoreChat(req.params.id);
      res.json({ success: true, chat: restored });
    } catch (error) {
      sendError(res, error, 404);
    }
  });

  router.post("/chats/:id/duplicate", (req, res) => {
    try {
      const chat = getChatById(req.params.id);
      if (!chat) {
        return res.status(404).json({
          success: false,
          error: { code: "CHAT_NOT_FOUND", message: "Чат не найден." },
        });
      }
      authorizeChatAccess(req.user, chat);
      const userId = req.user?.userId ?? null;
      const copy = duplicateChat(req.params.id, {
        ownerUserId: userId,
        createdByUserId: userId,
      });
      res.json({ success: true, chat: copy });
    } catch (error) {
      sendError(res, error, 404);
    }
  });

  // --- Search ---
  router.get("/search", (req, res) => {
    try {
      const results = searchWorkspace(req.query.q || req.query.query || "", {
        limit: req.query.limit,
        user: req.user,
      });
      res.json({ success: true, results });
    } catch (error) {
      sendError(res, error);
    }
  });

  // --- Settings (non-secret) ---
  router.get("/settings", (_req, res) => {
    res.json({ success: true, settings: listSettings() });
  });

  router.put("/settings/:key", (req, res) => {
    try {
      const value = setSetting(req.params.key, req.body?.value);
      res.json({ success: true, key: req.params.key, value });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/settings/:key", (req, res) => {
    res.json({ success: true, key: req.params.key, value: getSetting(req.params.key) });
  });

  return router;
}
