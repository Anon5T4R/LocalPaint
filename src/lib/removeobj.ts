/** "Remover objeto" — inpainting com LaMa (fatia ⑤).
 *
 *  O usuário seleciona algo (retângulo, laço, varinha — a seleção por MÁSCARA
 *  existe desde a v0.7.0) e manda remover; o modelo preenche o buraco com o
 *  que deveria estar atrás. Este módulo é a ORQUESTRAÇÃO (download do modelo,
 *  pixels da camada); a matemática de recorte/escala/colagem — onde mora o
 *  risco de erro de 1 pixel — é pura e testada em `inpaint.ts`.
 *
 *  A INFERÊNCIA NÃO MORA MAIS AQUI. Desde a v0.10.0 ela roda no
 *  `ai.worker.ts`: os ~20 s de `session.run` congelavam a janela inteira,
 *  porque o wasm do onnxruntime não cede a thread. Este módulo virou o
 *  recortador — pega os pixels, manda pro worker, recebe o resultado.
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

import { invoke } from "@tauri-apps/api/core";

import type { AiPhase } from "./aitypes";
import { runAi } from "./aiworker";
import type { Rect } from "./geometry";
import { cropMask, DILATE_PX, planInpaint } from "./inpaint";
import { dilateSel, type MaskSel } from "./mask";

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
  onPhase?: (p: AiPhase) => void,
): Promise<InpaintResult> {
  const path = await modelPath();
  if (!path) throw new Error("modelo ausente"); // a UI garante o download antes

  const grown = dilateSel(sel, docW, docH, DILATE_PX);
  const crop = planInpaint(grown.bounds, docW, docH);

  const ctx = canvas.getContext("2d")!;
  const before = ctx.getImageData(crop.x, crop.y, crop.w, crop.h);
  // `px` é a cópia descartável que atravessa pro worker e volta preenchida.
  // O `before` fica intacto de propósito: é ele que o undo devolve, e um
  // buffer transferido viria de volta com byteLength 0.
  const px = new Uint8ClampedArray(before.data);
  const mask = cropMask(grown, crop);

  // Reamostragem, tensores, inferência e colagem acontecem TODOS no worker
  // (ver `aitypes.ts` sobre onde a fronteira foi posta e por quê). Aqui a
  // thread principal só recorta e recebe — nada que dure mais que alguns ms.
  const r = await runAi({ task: "lama", rgba: px, mask, w: crop.w, h: crop.h }, path, onPhase);
  if (r.task !== "lama") throw new Error("resposta trocada"); // narrow, não deve ocorrer

  return { crop, before, after: new ImageData(r.rgba, crop.w, crop.h), inferenceMs: r.inferenceMs };
}
