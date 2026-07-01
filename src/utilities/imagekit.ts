// src/utilities/imagekit.ts
// ─────────────────────────────────────────────
// ImageKit.io integration (dependency-free)
//
// Uses ImageKit's REST API directly via the global `fetch`/`FormData`/`Blob`
// available in Node 18+. The private key never leaves the server — uploads and
// deletes are authenticated with HTTP Basic auth (privateKey as the username).
// ─────────────────────────────────────────────

import { env } from "./env";

const UPLOAD_URL = "https://upload.imagekit.io/api/v1/files/upload";
const FILES_URL = "https://api.imagekit.io/v1/files";
const FOLDER = "/rotapay/profile-pictures";

// HTTP Basic auth header: base64("<privateKey>:")
function authHeader(): string {
  const token = Buffer.from(`${env.IMAGEKIT_PRIVATE_KEY}:`).toString("base64");
  return `Basic ${token}`;
}

export interface UploadedImage {
  url: string;
  fileId: string;
}

// ─────────────────────────────────────────────
// Upload a base64-encoded image and return its URL + fileId.
// `base64` may be raw base64 or a full data URI — the prefix is stripped.
// ─────────────────────────────────────────────

export async function uploadProfileImage(
  base64: string,
  fileName: string
): Promise<UploadedImage> {
  const raw = base64.replace(/^data:[^;]+;base64,/, "");

  const form = new FormData();
  form.append("file", raw);
  form.append("fileName", fileName);
  form.append("folder", FOLDER);
  form.append("useUniqueFileName", "true");

  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: authHeader() },
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ImageKit upload failed (${res.status}): ${detail}`);
  }

  const data = (await res.json()) as { url?: string; fileId?: string };
  if (!data.url || !data.fileId) {
    throw new Error("ImageKit upload returned an unexpected response");
  }

  return { url: data.url, fileId: data.fileId };
}

// ─────────────────────────────────────────────
// Delete a file by its ImageKit fileId. Best-effort: a 404 (already gone) is
// treated as success; other failures are thrown so callers can log them.
// ─────────────────────────────────────────────

export async function deleteImage(fileId: string): Promise<void> {
  const res = await fetch(`${FILES_URL}/${fileId}`, {
    method: "DELETE",
    headers: { Authorization: authHeader() },
  });

  if (!res.ok && res.status !== 404) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ImageKit delete failed (${res.status}): ${detail}`);
  }
}
