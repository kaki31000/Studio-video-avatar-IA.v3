import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  GenerateAvatarVideoBody,
  GenerateAvatarVideoResponse,
  GetAvatarVideoTaskParams,
  GetAvatarVideoTaskResponse,
  GetStudioStatusResponse,
  StopAvatarVideoTaskParams,
  StopAvatarVideoTaskResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const engineBaseUrl = "http://localhost:80/agnes";
const maxImageBytes = 9 * 1024 * 1024;
const engineUploadsDir = resolve(process.cwd(), "../studio-avatar/agnes-engine/.working_dir/uploads");
const referenceImagesByTask = new Map<string, string[]>();

type EngineTask = {
  task_id?: unknown;
  status?: unknown;
  active?: unknown;
  current_progress?: unknown;
  current_step?: unknown;
  current_message?: unknown;
  error_traceback?: unknown;
};

function sendError(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
}

function taskIdFromRequest(req: Request): string | null {
  const parsed = GetAvatarVideoTaskParams.safeParse({ taskId: req.params.taskId });
  return parsed.success ? parsed.data.taskId : null;
}

function mapTaskStatus(rawStatus: unknown, active: unknown): "queued" | "running" | "completed" | "failed" | "stopped" | "unknown" {
  if (rawStatus === "completed") return "completed";
  if (rawStatus === "failed") return "failed";
  if (rawStatus === "running") return "running";
  if (rawStatus === "queued") return "queued";
  if (rawStatus === "pending") return active === true ? "queued" : "stopped";
  return "unknown";
}

function safeTaskError(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const usefulLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  return usefulLine ? usefulLine.slice(0, 300) : null;
}

async function removeReferenceImage(taskId: string): Promise<void> {
  const imagePaths = referenceImagesByTask.get(taskId);
  if (!imagePaths) return;
  referenceImagesByTask.delete(taskId);
  await Promise.all(imagePaths.map(removeTemporaryFile));
}

async function removeTemporaryFile(imagePath: string): Promise<void> {
  try {
    await rm(imagePath, { force: true });
  } catch {
    // The generation result remains usable even if temporary-file cleanup fails.
  }
}

router.get("/studio/status", async (req, res): Promise<void> => {
  const keyConfigured = Boolean(process.env.AGNES_API_KEY?.trim());
  try {
    const engineResponse = await fetch(`${engineBaseUrl}/api/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    const healthy = engineResponse.ok;
    const result = GetStudioStatusResponse.parse({
      configured: healthy && keyConfigured,
      engine: "agnes",
      message: !keyConfigured
        ? "La clé du moteur Agnes n’est pas configurée côté serveur."
        : healthy
          ? "Le moteur Agnes est prêt."
          : "Le service Agnes est momentanément inaccessible.",
    });
    res.json(result);
  } catch {
    const result = GetStudioStatusResponse.parse({
      configured: false,
      engine: "agnes",
      message: keyConfigured
        ? "Le service Agnes est momentanément inaccessible."
        : "La clé du moteur Agnes n’est pas configurée côté serveur.",
    });
    res.json(result);
  }
});

router.post("/studio/generate", async (req, res): Promise<void> => {
  const parsed = GenerateAvatarVideoBody.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, "Vérifiez le portrait, le script et les paramètres du rendu.");
    return;
  }

  const input = parsed.data;
  const requestApiKey = input.agnesApiKey?.trim();
  const dataUrlToBuffer = (dataUrl: string): { extension: string; bytes: Buffer } | null => {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
    if (!match) return null;
    const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
    if (!bytes.length || bytes.length > maxImageBytes) return null;
    return {
      extension: match[1] === "jpeg" ? "jpg" : match[1],
      bytes,
    };
  };
  const avatarImage = dataUrlToBuffer(input.avatarImageDataUrl);
  const sceneImages = (input.sceneImageDataUrls ?? []).map(dataUrlToBuffer);
  if (!avatarImage) {
    sendError(res, 400, "Le portrait doit être une image PNG, JPEG ou WebP valide.");
    return;
  }
  if (sceneImages.some((image) => !image)) {
    sendError(res, 400, "Chaque photo supplémentaire doit être une image PNG, JPEG ou WebP de moins de 9 Mo.");
    return;
  }
  const imagePaths: string[] = [];
  try {
    await mkdir(engineUploadsDir, { recursive: true });
    for (const image of [avatarImage, ...sceneImages] as Array<{ extension: string; bytes: Buffer }>) {
      const imagePath = join(engineUploadsDir, `${randomUUID()}.${image.extension}`);
      await writeFile(imagePath, image.bytes, { flag: "wx", mode: 0o600 });
      imagePaths.push(imagePath);
    }
  } catch (error) {
    req.log.error({ err: error }, "Unable to store temporary Agnes reference image");
    await Promise.all(imagePaths.map(removeTemporaryFile));
    sendError(res, 503, "Impossible de préparer le portrait pour le moteur Agnes.");
    return;
  }

  const dimensions = input.format === "16:9"
    ? { width: 1280, height: 720 }
    : input.format === "9:16"
      ? { width: 720, height: 1280 }
      : { width: 1024, height: 1024 };
  const direction = input.sceneDirection?.trim();
  const anchorPrompt = [
    "Preserve the person's identity and appearance from the supplied portrait.",
    "Create natural speech with realistic lip movement and expressive but restrained gestures.",
    "Create one continuous cinematic shot that fits the script; follow any requested movement and setting direction.",
    sceneImages.length
      ? "Use the additional reference photos as the scene background and environment. Keep the selected avatar photo as the primary identity and do not replace the avatar with people from the background photos."
      : "",
    direction ? `Direction de scène: ${direction}` : "",
  ].filter(Boolean).join("\n");

  const form = new FormData();
  form.set("script_text", input.scriptText.trim());
  if (requestApiKey) form.set("agnes_api_key", requestApiKey);
  form.set("anchor_prompt", anchorPrompt);
  form.set("anchor_reference_image", imagePaths[0]);
  form.set("scene_reference_images", JSON.stringify(imagePaths.slice(1)));
  form.set("video_duration", String(input.videoDuration ?? 15));
  form.set("scene_count", String(input.sceneCount ?? 1));
  form.set("audio_source", input.audioSource);
  form.set("video_width", String(dimensions.width));
  form.set("video_height", String(dimensions.height));
  form.set("audio_enabled", "true");
  form.set("audio_voice", input.audioVoice);
  form.set("audio_rate", "+0%");
  form.set("audio_lang", "fr");
  form.set("subtitle_enabled", "true");
  form.set("subtitle_font", "DejaVuSans.ttf");

  try {
    const upstream = await fetch(`${engineBaseUrl}/api/tasks/anchor`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(45_000),
    });
    if (!upstream.ok) {
      req.log.error({ upstreamStatus: upstream.status }, "Agnes task creation failed");
      await Promise.all(imagePaths.map(removeTemporaryFile));
      const errorMessage = upstream.status === 401
        ? "La clé Agnes fournie est refusée (401). Vérifiez-la puis réessayez."
        : "Agnes n’a pas accepté ce rendu. Vérifiez le portrait et le script, puis réessayez.";
      sendError(res, upstream.status === 404 || upstream.status === 401 ? 503 : 400, errorMessage);
      return;
    }

    const body: unknown = await upstream.json();
    const taskId = typeof body === "object" && body !== null && "task_id" in body
      ? (body as { task_id?: unknown }).task_id
      : null;
    if (typeof taskId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(taskId)) {
      req.log.error({ upstreamStatus: upstream.status }, "Agnes returned an invalid task identifier");
      await Promise.all(imagePaths.map(removeTemporaryFile));
      sendError(res, 502, "Agnes a renvoyé une réponse inattendue.");
      return;
    }

    referenceImagesByTask.set(taskId, imagePaths);
    res.status(202).json(GenerateAvatarVideoResponse.parse({ taskId, accepted: true }));
  } catch (error) {
    req.log.error({ err: error }, "Agnes task creation request failed");
    await Promise.all(imagePaths.map(removeTemporaryFile));
    sendError(res, 503, "Impossible de joindre le moteur Agnes pour le moment.");
  }
});

router.get("/studio/tasks/:taskId", async (req, res): Promise<void> => {
  const taskId = taskIdFromRequest(req);
  if (!taskId) {
    sendError(res, 400, "Identifiant de tâche invalide.");
    return;
  }

  try {
    const upstream = await fetch(`${engineBaseUrl}/api/tasks/${encodeURIComponent(taskId)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (upstream.status === 404) {
      sendError(res, 404, "Tâche introuvable.");
      return;
    }
    if (!upstream.ok) {
      req.log.error({ taskId, upstreamStatus: upstream.status }, "Agnes task status request failed");
      sendError(res, 502, "Impossible de lire l’état du rendu.");
      return;
    }

    const body = await upstream.json() as EngineTask;
    const status = mapTaskStatus(body.status, body.active);
    const numericProgress = typeof body.current_progress === "number" && Number.isFinite(body.current_progress)
      ? Math.max(0, Math.min(1, body.current_progress))
      : 0;
    const result = GetAvatarVideoTaskResponse.parse({
      taskId,
      status,
      progress: status === "completed" ? 1 : numericProgress,
      step: typeof body.current_message === "string" && body.current_message.trim()
        ? body.current_message.trim().slice(0, 240)
        : typeof body.current_step === "string" && body.current_step.trim()
          ? body.current_step.trim().slice(0, 120)
          : "Préparation du rendu",
       error: status === "failed"
         ? /(?:401|Unauthorized)/i.test(`${body.error_traceback ?? ""} ${body.current_message ?? ""}`)
           ? "La clé Agnes est refusée (401). Remplacez AGNES_API_KEY dans les secrets Replit, puis redémarrez le moteur."
           : safeTaskError(body.error_traceback)
         : null,
      videoUrl: status === "completed" ? `/api/studio/tasks/${encodeURIComponent(taskId)}/video` : null,
    });
    if (status === "completed" || status === "failed" || status === "stopped") {
      await removeReferenceImage(taskId);
    }
    res.json(result);
  } catch (error) {
    req.log.error({ taskId, err: error }, "Agnes task status request failed");
    sendError(res, 503, "Impossible de joindre le moteur Agnes pour le moment.");
  }
});

router.post("/studio/tasks/:taskId/stop", async (req, res): Promise<void> => {
  const parsed = StopAvatarVideoTaskParams.safeParse({ taskId: req.params.taskId });
  if (!parsed.success) {
    sendError(res, 400, "Identifiant de tâche invalide.");
    return;
  }
  const { taskId } = parsed.data;

  try {
    const upstream = await fetch(`${engineBaseUrl}/api/tasks/${encodeURIComponent(taskId)}/stop`, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
    });
    if (upstream.status === 404) {
      sendError(res, 404, "Tâche introuvable.");
      return;
    }
    if (!upstream.ok) {
      sendError(res, 409, "Ce rendu ne peut plus être arrêté.");
      return;
    }
    res.json(StopAvatarVideoTaskResponse.parse({ taskId, stopped: true }));
  } catch (error) {
    req.log.error({ taskId, err: error }, "Agnes task stop request failed");
    sendError(res, 503, "Impossible de joindre le moteur Agnes pour le moment.");
  }
});

router.get("/studio/tasks/:taskId/video", async (req, res): Promise<void> => {
  const taskId = taskIdFromRequest(req);
  if (!taskId) {
    sendError(res, 400, "Identifiant de tâche invalide.");
    return;
  }

  try {
    const headers: Record<string, string> = {};
    if (req.headers.range) headers.Range = req.headers.range;
    const upstream = await fetch(`${engineBaseUrl}/api/video/${encodeURIComponent(taskId)}`, {
      headers,
      signal: AbortSignal.timeout(120_000),
    });
    if (upstream.status === 404) {
      sendError(res, 404, "La vidéo n’est pas encore disponible.");
      return;
    }
    if (!upstream.ok || !upstream.body) {
      req.log.error({ taskId, upstreamStatus: upstream.status }, "Agnes video download failed");
      sendError(res, 502, "Impossible de récupérer la vidéo générée.");
      return;
    }

    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "video/mp4");
    for (const header of ["accept-ranges", "content-range", "content-length"]) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    res.setHeader("Cache-Control", "private, no-store");
    await pipeline(Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream), res);
  } catch (error) {
    req.log.error({ taskId, err: error }, "Agnes video download request failed");
    if (!res.headersSent) sendError(res, 503, "Impossible de joindre le moteur Agnes pour le moment.");
    else res.destroy();
  }
});

export default router;