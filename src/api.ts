export class ApiError extends Error {
  status: number;
  data: any;
  constructor(message: string, status: number, data?: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const res = await fetch("/api" + path, {
    method: opts.method ?? (opts.body || opts.form ? "POST" : "GET"),
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
    credentials: "same-origin",
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data);
  return data as T;
}

export type User = { id: number; name: string; email: string; role: "ADMIN" | "MANAGER" | "STAFF" };

export const fmtDate = (d?: string | null) => {
  if (!d) return "-";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};
export const todayStr = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
export const daysUntil = (d?: string | null) => {
  if (!d) return null;
  return Math.round((new Date(d + "T00:00:00Z").getTime() - new Date(todayStr() + "T00:00:00Z").getTime()) / 86400000);
};
export const fmtSize = (n?: number | null) => (!n ? "" : n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");
export const fmtDateTime = (d?: string | null) => (d ? new Date(d.replace(" ", "T") + "Z").toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "-");

export const STATUS_LABEL: Record<string, string> = { OPEN: "Open", IN_PROGRESS: "In progress", WAITING_CLIENT: "Waiting for client", REVIEW: "In review", ON_HOLD: "On hold", DONE: "Done" };
export const CATEGORY_LABEL: Record<string, string> = { ANNUAL: "Annual", RECURRING: "Recurring", ONE_TIME: "One-time", CUSTOM: "Custom" };

/** Shrink phone photos / scans in the browser before upload (PDFs are sent as they are). */
export async function compressImage(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 250 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.72));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}
