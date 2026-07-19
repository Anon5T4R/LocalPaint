/** Remoção de fundo offline (backlog B4) — isnet-general-use via onnxruntime-web.
 *
 *  O modelo (~170 MB, Apache-2.0, do repo rembg) NÃO vai no instalador: baixa
 *  sob demanda do espelho da suíte (Local-runtimes), com sha256 conferido pelo
 *  Rust ANTES do arquivo existir no caminho final (`src-tauri/src/download.rs`).
 *  URL e hash moram AQUI, no front — o Rust só executa o que lhe mandam.
 *
 *  O arquivo chega ao webview por `convertFileSrc` (asset protocol, escopo =
 *  só a pasta de modelos), nunca por base64: 170 MB virariam ~230 MB de string.
 *
 *  Os macetes de WASM (bundle só-CPU, runtime por `?url`, `numThreads = 1`)
 *  moram em `ort.ts` desde a fatia ⑤ — com dois modelos no app, duas cópias da
 *  mesma configuração divergindo é o bug que a v0.5.0 já pagou.
 */

import { convertFileSrc, invoke } from "@tauri-apps/api/core";

import { saliencyToAlpha, toIsnetInput } from "./matte";
import { ort } from "./ort";

/** Asset do espelho da suíte (entrada correspondente no MANIFEST.json de lá). */
export const MODEL_FILE = "isnet-general-use.onnx";
export const MODEL_URL = "https://github.com/Anon5T4R/Local-runtimes/releases/download/v1/isnet-general-use.onnx";
export const MODEL_SHA256 = "60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a";
export const MODEL_BYTES = 178648008;

/** Resolução de treino do isnet — a entrada é SEMPRE reamostrada pra cá. */
const INPUT_DIM = 1024;

/** Caminho do modelo no disco, ou null se ainda não foi baixado. */
export function modelPath(): Promise<string | null> {
  return invoke<string | null>("model_path", { file: MODEL_FILE });
}

/** Baixa o modelo (progresso sai pelo evento Tauri `model-progress`). */
export function fetchModel(): Promise<string> {
  return invoke<string>("model_fetch", { url: MODEL_URL, sha256: MODEL_SHA256, file: MODEL_FILE });
}

/** Pede o cancelamento do download em curso. */
export function cancelFetch(): Promise<void> {
  return invoke<void>("model_cancel");
}

let sessionPromise: Promise<ort.InferenceSession> | null = null;

/** Sessão única e cacheada (criar custa segundos; o modelo não muda).
 *  Falha limpa o cache — a próxima tentativa recomeça do zero. */
function ensureSession(path: string): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const res = await fetch(convertFileSrc(path));
      // Lição do LocalVideo: o asset protocol responde ERRO (não o arquivo)
      // pra caminho fora do escopo — sem este cheque o corpo do erro iria
      // de "modelo" pro onnxruntime e o diagnóstico viraria adivinhação.
      if (!res.ok) throw new Error(`asset ${res.status}`);
      const buf = await res.arrayBuffer();
      return ort.InferenceSession.create(new Uint8Array(buf), { executionProviders: ["wasm"] });
    })();
    sessionPromise.catch(() => {
      sessionPromise = null;
    });
  }
  return sessionPromise;
}

export interface BgRemoveResult {
  /** Pixels ORIGINAIS da camada, intocados — o modo Refinar precisa deles. */
  original: ImageData;
  /** Máscara 0–255 em resolução cheia (convenção matte.ts, alpha contínuo). */
  mask: Uint8ClampedArray;
}

/** Roda o isnet na imagem do canvas e devolve `{ original, mask }` — quem
 *  aplica é o modo Refinar (state/refine.ts): a máscara vira editável antes
 *  de gravar. Não toca no canvas de entrada. */
export async function removeBackground(canvas: HTMLCanvasElement): Promise<BgRemoveResult> {
  const path = await modelPath();
  if (!path) throw new Error("modelo ausente"); // a UI garante o download antes
  const session = await ensureSession(path);

  // 1. Reamostra pra 1024×1024 (o isnet só conhece esse tamanho).
  const off = document.createElement("canvas");
  off.width = INPUT_DIM;
  off.height = INPUT_DIM;
  const octx = off.getContext("2d")!;
  octx.drawImage(canvas, 0, 0, INPUT_DIM, INPUT_DIM);
  const small = octx.getImageData(0, 0, INPUT_DIM, INPUT_DIM);

  // 2. Inferência.
  const tensor = new ort.Tensor("float32", toIsnetInput(small.data, INPUT_DIM, INPUT_DIM), [1, 3, INPUT_DIM, INPUT_DIM]);
  const results = await session.run({ [session.inputNames[0]]: tensor });
  const out = results[session.outputNames[0]];
  const dims = out.dims;
  const outH = dims[dims.length - 2] ?? INPUT_DIM;
  const outW = dims[dims.length - 1] ?? INPUT_DIM;
  const alpha = saliencyToAlpha(out.data as Float32Array);

  // 3. Máscara → canvas (branco + alpha), upscale bilinear pro tamanho real.
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = outW;
  maskCanvas.height = outH;
  const mctx = maskCanvas.getContext("2d")!;
  const maskImg = mctx.createImageData(outW, outH);
  for (let i = 0; i < alpha.length; i++) {
    maskImg.data[i * 4] = 255;
    maskImg.data[i * 4 + 1] = 255;
    maskImg.data[i * 4 + 2] = 255;
    maskImg.data[i * 4 + 3] = alpha[i];
  }
  mctx.putImageData(maskImg, 0, 0);

  const scaled = document.createElement("canvas");
  scaled.width = canvas.width;
  scaled.height = canvas.height;
  const sctx = scaled.getContext("2d")!;
  sctx.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height);
  const scaledMask = sctx.getImageData(0, 0, canvas.width, canvas.height);

  // 4. Devolve os originais + a máscara em resolução cheia (um byte por px).
  const original = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
  const mask = new Uint8ClampedArray(scaledMask.data.length >> 2);
  for (let i = 0; i < mask.length; i++) mask[i] = scaledMask.data[i * 4 + 3];
  return { original, mask };
}
