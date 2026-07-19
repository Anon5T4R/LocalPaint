/** Modo REFINAR da remoção de fundo (fatia ③) — estado e buffers.
 *
 *  O achado que barateia tudo (análise §4.1): a remoção NÃO destrói os RGB —
 *  o applyMaskAlpha só multiplica o alpha. Então em vez de aplicar direto, o
 *  removeBackground devolve `{ original, mask }` e este modo deixa o usuário
 *  EDITAR a máscara com o pincel antes de gravar.
 *
 *  Buffers moram FORA do zustand (mesma razão das camadas: array grande
 *  mutável não é estado imutável). O store guarda só os knobs do modo.
 *
 *  Modelo de commit: durante o modo, o canvas da CAMADA mostra o preview
 *  (original × máscara) — o compositor não muda nada. Aplicar grava com UM
 *  undo (before = original intocado, after = original × máscara suavizada);
 *  cancelar devolve o original e não toca o histórico. Enquanto o modo vive,
 *  o App bloqueia undo/salvar/exportar — o canvas da camada está "emprestado"
 *  pro preview.
 */

import { create } from "zustand";

import { blurMask, composeRectRgba, paintMaskDab, veilRectRgba } from "../lib/refine";
import { applyMaskAlpha } from "../lib/matte";
import { getLayerCanvas, layerCtx, requestRender } from "../lib/layers";
import type { Rect } from "../lib/geometry";
import { useDoc } from "./doc";

let original: ImageData | null = null;
/** A máscara que o pincel edita (0–255, convenção matte.ts). */
let baseMask: Uint8ClampedArray | null = null;
/** A máscara EXIBIDA: blur(base) quando smooth>0, cópia da base quando 0.
 *  O dab pinta nas duas pra feedback imediato; o fim do traço re-borra. */
let effMask: Uint8ClampedArray | null = null;
let veilCanvas: HTMLCanvasElement | null = null;

export function getVeilCanvas(): HTMLCanvasElement | null {
  return veilCanvas;
}

function updateRect(layerId: string, r: Rect): void {
  if (!original || !effMask || !getLayerCanvas(layerId)) return;
  const w = original.width;
  layerCtx(layerId).putImageData(new ImageData(composeRectRgba(original.data, effMask, w, r), r.w, r.h), r.x, r.y);
  veilCanvas?.getContext("2d")!.putImageData(new ImageData(veilRectRgba(effMask, w, r), r.w, r.h), r.x, r.y);
}

function refreshFull(layerId: string, smooth: number): void {
  if (!original || !baseMask) return;
  effMask = smooth > 0 ? blurMask(baseMask, original.width, original.height, smooth) : new Uint8ClampedArray(baseMask);
  updateRect(layerId, { x: 0, y: 0, w: original.width, h: original.height });
  requestRender();
}

function drop(): void {
  original = null;
  baseMask = null;
  effMask = null;
  veilCanvas = null;
}

export type RefineMode = "restore" | "erase";

interface RefineState {
  active: boolean;
  layerId: string | null;
  mode: RefineMode;
  /** Raio do "Suavizar borda" (blur da máscara), 0..30. */
  smooth: number;
  veil: boolean;

  /** Entra no modo: guarda os buffers e troca o canvas da camada pelo preview. */
  start: (layerId: string, orig: ImageData, mask: Uint8ClampedArray) => void;
  setMode: (m: RefineMode) => void;
  setSmooth: (n: number) => void;
  setVeil: (v: boolean) => void;
  /** Um toque do pincel em coordenada de DOC (o CanvasStage interpola o traço). */
  paintAt: (x: number, y: number, radius: number, erase: boolean) => void;
  /** Fim do traço: com suavização ativa, re-borra a exibição a partir da base. */
  endStroke: () => void;
  /** Grava na camada com UM undo (before/after da camada inteira) e sai. */
  apply: () => void;
  /** Sai sem tocar a camada (devolve o original) nem o histórico. */
  cancel: () => void;
}

export const useRefine = create<RefineState>((set, get) => ({
  active: false,
  layerId: null,
  mode: "restore",
  smooth: 0,
  veil: false,

  start: (layerId, orig, mask) => {
    original = orig;
    baseMask = new Uint8ClampedArray(mask);
    veilCanvas = document.createElement("canvas");
    veilCanvas.width = orig.width;
    veilCanvas.height = orig.height;
    set({ active: true, layerId, mode: "restore", smooth: 0, veil: false });
    refreshFull(layerId, 0);
  },

  setMode: (mode) => set({ mode }),

  setSmooth: (n) => {
    const smooth = Math.min(30, Math.max(0, Math.round(n)));
    set({ smooth });
    const { active, layerId } = get();
    if (active && layerId) refreshFull(layerId, smooth);
  },

  setVeil: (veil) => {
    set({ veil });
    requestRender();
  },

  paintAt: (x, y, radius, erase) => {
    const { active, layerId } = get();
    if (!active || !layerId || !original || !baseMask || !effMask) return;
    const w = original.width;
    const h = original.height;
    const r = paintMaskDab(baseMask, w, h, x, y, radius, !erase);
    paintMaskDab(effMask, w, h, x, y, radius, !erase);
    if (r) {
      updateRect(layerId, r);
      requestRender();
    }
  },

  endStroke: () => {
    const { active, layerId, smooth } = get();
    if (active && layerId && smooth > 0) refreshFull(layerId, smooth);
  },

  apply: () => {
    const { active, layerId, smooth } = get();
    if (!active || !layerId) return;
    if (!original || !baseMask || !getLayerCanvas(layerId)) {
      // Camada morreu debaixo do modo (caso raro) — sai limpo, sem histórico.
      drop();
      set({ active: false, layerId: null });
      requestRender();
      return;
    }
    const { width, height } = original;
    // Recalcula da BASE (não da exibição, que pode ter dabs duros pós-blur).
    const eff = smooth > 0 ? blurMask(baseMask, width, height, smooth) : baseMask;
    const before = new Uint8ClampedArray(original.data);
    const after = new Uint8ClampedArray(original.data);
    applyMaskAlpha(after, eff);
    layerCtx(layerId).putImageData(new ImageData(new Uint8ClampedArray(after), width, height), 0, 0);
    useDoc.getState().pushHistory({
      label: "bgRefine",
      bytes: before.byteLength * 2,
      undo: () => {
        if (getLayerCanvas(layerId)) layerCtx(layerId).putImageData(new ImageData(new Uint8ClampedArray(before), width, height), 0, 0);
      },
      redo: () => {
        if (getLayerCanvas(layerId)) layerCtx(layerId).putImageData(new ImageData(new Uint8ClampedArray(after), width, height), 0, 0);
      },
    });
    drop();
    set({ active: false, layerId: null });
    requestRender();
  },

  cancel: () => {
    const { active, layerId } = get();
    if (!active) return;
    if (layerId && original && getLayerCanvas(layerId)) {
      layerCtx(layerId).putImageData(
        new ImageData(new Uint8ClampedArray(original.data), original.width, original.height),
        0,
        0,
      );
    }
    drop();
    set({ active: false, layerId: null });
    requestRender();
  },
}));
