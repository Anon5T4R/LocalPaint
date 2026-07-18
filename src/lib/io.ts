/** Abrir/salvar — a cola entre diálogos, o codec puro e os canvases.
 *
 *  Só este módulo fala com o Rust (`read_file_b64`/`write_file_b64`) e com o
 *  plugin de diálogo. Os componentes chamam estas funções e mostram toast do
 *  que der errado — nenhum `alert()` cru (lição da pass de maturidade:
 *  Office/Slides ainda pagam por isso).
 */

import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";

import { flatten } from "./compose";
import { clearAllLayerCanvases, createLayerCanvas, layerCtx } from "./layers";
import { bumpIdsPast, newLayerMeta, type LayerMeta } from "./model";
import { parseTpaint, serializeTpaint } from "./tpaint";
import { t } from "./i18n";
import { useDoc } from "../state/doc";

// ── bytes ↔ base64 (a ponte com o Rust) ─────────────────────────────────────

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  // Em blocos: `String.fromCharCode(...tudo)` estoura a pilha com PNG grande.
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

async function readFile(path: string): Promise<Uint8Array> {
  return b64ToBytes(await invoke<string>("read_file_b64", { path }));
}

async function writeFile(path: string, bytes: Uint8Array): Promise<void> {
  await invoke("write_file_b64", { path, data: bytesToB64(bytes) });
}

function canvasToPng(c: HTMLCanvasElement, mime = "image/png", quality?: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    c.toBlob(
      (blob) => {
        if (!blob) return reject(new Error("toBlob falhou"));
        void blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)));
      },
      mime,
      quality,
    );
  });
}

// ── abrir ───────────────────────────────────────────────────────────────────

export async function pickAndOpen(): Promise<void> {
  const path = await openDialog({
    multiple: false,
    filters: [
      { name: t("io.filterAll"), extensions: ["tpaint", "png", "jpg", "jpeg", "webp", "bmp", "gif"] },
      { name: "LocalPaint", extensions: ["tpaint"] },
      { name: t("io.filterImages"), extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif"] },
    ],
  });
  if (typeof path !== "string") return;
  await openPath(path);
}

/** Abre .tpaint OU imagem achatada — decide pela extensão. Usado também pelo
 *  boot (associação de arquivo) e pela segunda instância. */
export async function openPath(path: string): Promise<void> {
  if (/\.tpaint$/i.test(path)) return openTpaint(path);
  return openFlatImage(path);
}

async function openTpaint(path: string): Promise<void> {
  const doc = await parseTpaint(await readFile(path));
  clearAllLayerCanvases();
  const metas: LayerMeta[] = [];
  for (const l of doc.layers) {
    createLayerCanvas(l.meta.id, doc.meta.width, doc.meta.height);
    const bmp = await createImageBitmap(new Blob([l.png.slice().buffer], { type: "image/png" }));
    layerCtx(l.meta.id).drawImage(bmp, 0, 0);
    bmp.close();
    metas.push(l.meta);
  }
  bumpIdsPast(metas.map((m) => m.id));
  useDoc.getState().adoptDoc(doc.meta.width, doc.meta.height, metas, path);
}

async function openFlatImage(path: string): Promise<void> {
  const bytes = await readFile(path);
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(new Blob([bytes.slice().buffer]));
  } catch {
    throw new Error(t("io.badImage"));
  }
  clearAllLayerCanvases();
  const meta = newLayerMeta(t("layers.background"));
  createLayerCanvas(meta.id, bmp.width, bmp.height);
  layerCtx(meta.id).drawImage(bmp, 0, 0);
  const w = bmp.width;
  const h = bmp.height;
  bmp.close();
  // Imagem achatada NÃO vira o filePath do doc: salvar de novo é Save As —
  // sobrescrever o PNG do usuário com um .tpaint seria surpresa das ruins.
  useDoc.getState().adoptDoc(w, h, [meta], null);
}

// ── salvar ──────────────────────────────────────────────────────────────────

/** Salva no caminho atual, ou pergunta se não houver. Devolve false se o
 *  usuário cancelou o diálogo (quem chama decide se isso importa). */
export async function saveDoc(forceAsk = false): Promise<boolean> {
  const s = useDoc.getState();
  let path = s.filePath;
  if (!path || forceAsk) {
    const picked = await saveDialog({
      defaultPath: path ?? `${t("io.untitledFile")}.tpaint`,
      filters: [{ name: "LocalPaint", extensions: ["tpaint"] }],
    });
    if (typeof picked !== "string") return false;
    path = picked.endsWith(".tpaint") ? picked : `${picked}.tpaint`;
  }

  const layers = [];
  for (const meta of s.layers) {
    const c = document.createElement("canvas");
    c.width = s.width;
    c.height = s.height;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("canvas 2d indisponível");
    const src = layerCtx(meta.id).canvas;
    ctx.drawImage(src, 0, 0);
    layers.push({ meta, png: await canvasToPng(c) });
  }
  const bytes = await serializeTpaint({ meta: { width: s.width, height: s.height }, layers });
  await writeFile(path, bytes);
  useDoc.getState().markSaved(path);
  return true;
}

// ── exportar ────────────────────────────────────────────────────────────────

export type ExportFormat = "png" | "jpg" | "webp";

export async function exportFlat(format: ExportFormat): Promise<string | null> {
  const s = useDoc.getState();
  const picked = await saveDialog({
    defaultPath: `${t("io.untitledFile")}.${format}`,
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  });
  if (typeof picked !== "string") return null;
  const path = picked.toLowerCase().endsWith(`.${format}`) ? picked : `${picked}.${format}`;

  const mime = format === "png" ? "image/png" : format === "jpg" ? "image/jpeg" : "image/webp";
  // JPG não tem alpha: achata sobre branco (ver flatten).
  const flat = flatten(s.width, s.height, s.layers, format === "jpg" ? "#ffffff" : undefined);
  const bytes = await canvasToPng(flat, mime, format === "png" ? undefined : 0.92);
  await writeFile(path, bytes);
  return path;
}
