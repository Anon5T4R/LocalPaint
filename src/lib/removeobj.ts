/** "Remover objeto" — inpainting com LaMa (fatia ⑤).
 *
 *  O usuário seleciona algo (retângulo, laço, varinha — a seleção por MÁSCARA
 *  existe desde a v0.7.0) e manda remover; o modelo preenche o buraco com o
 *  que deveria estar atrás. Este módulo é a ORQUESTRAÇÃO (sessão do ORT,
 *  pixels da camada, medição); a matemática de recorte/escala/colagem — onde
 *  mora o risco de erro de 1 pixel — é pura e testada em `inpaint.ts`.
 *
 *  Por que LaMa e não MI-GAN (decisão do João, `analises-viabilidade.md`
 *  §4.6b): no mesmo teste o MI-GAN deixou fantasma visível e o LaMa saiu
 *  impecável. "200 MB não é tanto pra essa função." O MI-GAN segue espelhado,
 *  custo zero, caso um dia se queira uma opção leve.
 *
 *  Padrão de download idêntico ao do isnet (`bgremove.ts`): sob demanda, do
 *  espelho da suíte, com sha256 conferido no Rust ANTES do rename. URL, hash e
 *  nome do arquivo moram AQUI, no front — o Rust só executa o que lhe mandam.
 */

import { convertFileSrc, invoke } from "@tauri-apps/api/core";

import type { Rect } from "./geometry";
import {
  blendHole,
  cropMask,
  DILATE_PX,
  fromLamaOutput,
  INPAINT_DIM,
  planInpaint,
  resample,
  resampleMaskMax,
  toLamaImage,
  toLamaMask,
} from "./inpaint";
import { dilateSel, type MaskSel } from "./mask";
import { ort } from "./ort";

/** Asset do espelho da suíte (entrada correspondente no MANIFEST.json de lá).
 *  O Hugging Face fica FORA do caminho crítico de propósito: a fonte
 *  alternativa do MI-GAN (`Sanster/models`) ficou privada no meio do caminho e
 *  provou o ponto do espelho. */
export const MODEL_FILE = "lama_fp32.onnx";
export const MODEL_URL = "https://github.com/Anon5T4R/Local-runtimes/releases/download/v1/lama_fp32.onnx";
export const MODEL_SHA256 = "1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6";
export const MODEL_BYTES = 208044816;

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

/** Sessão única e cacheada. Criar custa ~8 s pra este modelo (208 MB de pesos
 *  parseados no wasm), e o modelo não muda — pagar isso por clique seria
 *  dobrar o tempo percebido. Falha limpa o cache: a próxima tentativa
 *  recomeça do zero em vez de herdar uma sessão morta. */
function ensureSession(path: string): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const res = await fetch(convertFileSrc(path));
      // Lição do LocalVideo: o asset protocol responde ERRO (não o arquivo)
      // pra caminho fora do escopo — sem este cheque o corpo do erro iria do
      // "modelo" pro onnxruntime e o diagnóstico viraria adivinhação.
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

export interface InpaintResult {
  /** Janela do documento que foi processada (o undo é o dirty-rect dela). */
  crop: Rect;
  /** Pixels da janela ANTES — o undo devolve exatamente isto. */
  before: ImageData;
  /** Pixels da janela DEPOIS (só o buraco difere do `before`). */
  after: ImageData;
  /** Tempo só da inferência, em ms — pro app poder ser honesto sobre demora. */
  inferenceMs: number;
}

/** Roda o inpainting na seleção e devolve o antes/depois da janela recortada.
 *  NÃO toca a camada nem o histórico — quem chama aplica e grava UMA entrada
 *  de undo (o resultado inteiro é uma ação só pro usuário).
 *
 *  A seleção é DILATADA antes de virar buraco: máscara crua encostada no
 *  objeto deixa halo do próprio objeto na borda (ver `DILATE_PX`). */
export async function removeObject(
  canvas: HTMLCanvasElement,
  sel: MaskSel,
  docW: number,
  docH: number,
): Promise<InpaintResult> {
  const path = await modelPath();
  if (!path) throw new Error("modelo ausente"); // a UI garante o download antes
  const session = await ensureSession(path);

  const grown = dilateSel(sel, docW, docH, DILATE_PX);
  const crop = planInpaint(grown.bounds, docW, docH);

  const ctx = canvas.getContext("2d")!;
  const before = ctx.getImageData(crop.x, crop.y, crop.w, crop.h);
  const px = new Uint8ClampedArray(before.data);
  const mask = cropMask(grown, crop);

  // Janela → 512 (identidade quando já é 512: `resample` devolve cópia).
  const img512 = resample(px, crop.w, crop.h, INPAINT_DIM, INPAINT_DIM);
  const mask512 = resampleMaskMax(mask, crop.w, crop.h, INPAINT_DIM, INPAINT_DIM);

  const t0 = performance.now();
  const out = await session.run({
    image: new ort.Tensor("float32", toLamaImage(img512, INPAINT_DIM, INPAINT_DIM), [1, 3, INPAINT_DIM, INPAINT_DIM]),
    mask: new ort.Tensor("float32", toLamaMask(mask512), [1, 1, INPAINT_DIM, INPAINT_DIM]),
  });
  const inferenceMs = performance.now() - t0;

  const filled512 = fromLamaOutput(out.output.data as Float32Array, INPAINT_DIM, INPAINT_DIM);
  const filled = resample(filled512, INPAINT_DIM, INPAINT_DIM, crop.w, crop.h);
  // Colagem pela máscara NATIVA: só o buraco muda, o entorno volta byte a
  // byte igual (é o que o teste de `blendHole` trava).
  blendHole(px, filled, mask);

  return { crop, before, after: new ImageData(px, crop.w, crop.h), inferenceMs };
}
