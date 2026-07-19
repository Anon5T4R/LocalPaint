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

import { composeRectRgba, decontaminateEdge, featherMask, veilRectRgba } from "../lib/refine";
import { paintMaskDab } from "../lib/maskpaint";
import { applyMaskAlpha } from "../lib/matte";
import { getLayerCanvas, layerCtx, requestRender } from "../lib/layers";
import type { Rect } from "../lib/geometry";
import { useDoc } from "./doc";

let original: ImageData | null = null;
/** A máscara que o pincel edita (0–255, convenção matte.ts). */
let baseMask: Uint8ClampedArray | null = null;
/** A máscara EXIBIDA: feather(base) quando smooth>0, cópia da base quando 0.
 *  O dab pinta nas duas pra feedback imediato; o fim do traço re-suaviza. */
let effMask: Uint8ClampedArray | null = null;
/** RGB mostrado no preview: o do original quando decontam=0, senão a cópia
 *  descontaminada. Só o RGB muda — o alpha continua vindo da máscara. */
let shownRgb: Uint8ClampedArray | null = null;
let veilCanvas: HTMLCanvasElement | null = null;

export function getVeilCanvas(): HTMLCanvasElement | null {
  return veilCanvas;
}

/** Raio de busca da descontaminação. O feather ALARGA a franja (3 passadas de
 *  box espalham ~raio pra cada lado), e uma busca que não atravessa a franja
 *  volta vazia e não corrige nada — ver o contrato do raio no `refine.ts`.
 *  Somar o smooth é o que impede o par de sliders de cair nesse buraco. */
function searchRadius(decontam: number, smooth: number): number {
  return decontam + smooth;
}

function updateRect(layerId: string, r: Rect): void {
  if (!original || !effMask || !shownRgb || !getLayerCanvas(layerId)) return;
  const w = original.width;
  layerCtx(layerId).putImageData(new ImageData(composeRectRgba(shownRgb, effMask, w, r), r.w, r.h), r.x, r.y);
  veilCanvas?.getContext("2d")!.putImageData(new ImageData(veilRectRgba(effMask, w, r), r.w, r.h), r.x, r.y);
}

/** Recalcula máscara efetiva + RGB exibido a partir da BASE e redesenha tudo.
 *  Sempre da base: os dois efeitos são idempotentes por reconstrução, nunca
 *  acumulados (arrastar o slider pra frente e pra trás tem que voltar ao mesmo
 *  pixel — acumular blur sobre blur não volta). */
function refreshFull(layerId: string, smooth: number, decontam: number): void {
  if (!original || !baseMask) return;
  const { width, height } = original;
  effMask = smooth > 0 ? featherMask(baseMask, width, height, smooth) : new Uint8ClampedArray(baseMask);
  if (decontam > 0) {
    shownRgb = new Uint8ClampedArray(original.data);
    decontaminateEdge(shownRgb, effMask, width, height, searchRadius(decontam, smooth));
  } else {
    shownRgb = original.data;
  }
  updateRect(layerId, { x: 0, y: 0, w: width, h: height });
  requestRender();
}

function drop(): void {
  original = null;
  baseMask = null;
  effMask = null;
  shownRgb = null;
  veilCanvas = null;
}

export type RefineMode = "restore" | "erase";

interface RefineState {
  active: boolean;
  layerId: string | null;
  mode: RefineMode;
  /** Raio do "Suavizar borda" (feather da máscara), 0..30. */
  smooth: number;
  /** Raio do "Descontaminar borda" (tirar o resíduo do fundo velho), 0..10.
   *  0 = desligado, e é o padrão: a correção reescreve RGB, e reescrever pixel
   *  sem o usuário pedir não é o contrato de nenhuma outra ferramenta daqui. */
  decontam: number;
  veil: boolean;

  /** Entra no modo: guarda os buffers e troca o canvas da camada pelo preview. */
  start: (layerId: string, orig: ImageData, mask: Uint8ClampedArray) => void;
  setMode: (m: RefineMode) => void;
  setSmooth: (n: number) => void;
  setDecontam: (n: number) => void;
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
  decontam: 0,
  veil: false,

  start: (layerId, orig, mask) => {
    original = orig;
    baseMask = new Uint8ClampedArray(mask);
    veilCanvas = document.createElement("canvas");
    veilCanvas.width = orig.width;
    veilCanvas.height = orig.height;
    set({ active: true, layerId, mode: "restore", smooth: 0, decontam: 0, veil: false });
    refreshFull(layerId, 0, 0);
  },

  setMode: (mode) => set({ mode }),

  setSmooth: (n) => {
    const smooth = Math.min(30, Math.max(0, Math.round(n)));
    set({ smooth });
    const { active, layerId, decontam } = get();
    if (active && layerId) refreshFull(layerId, smooth, decontam);
  },

  setDecontam: (n) => {
    const decontam = Math.min(10, Math.max(0, Math.round(n)));
    set({ decontam });
    const { active, layerId, smooth } = get();
    if (active && layerId) refreshFull(layerId, smooth, decontam);
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
    const { active, layerId, smooth, decontam } = get();
    // O dab pinta duro nas duas máscaras pra dar retorno imediato; no fim do
    // traço os dois efeitos são refeitos da base sobre a máscara nova.
    if (active && layerId && (smooth > 0 || decontam > 0)) refreshFull(layerId, smooth, decontam);
  },

  apply: () => {
    const { active, layerId, smooth, decontam } = get();
    if (!active || !layerId) return;
    if (!original || !baseMask || !getLayerCanvas(layerId)) {
      // Camada morreu debaixo do modo (caso raro) — sai limpo, sem histórico.
      drop();
      set({ active: false, layerId: null });
      requestRender();
      return;
    }
    const { width, height } = original;
    // Recalcula da BASE (não da exibição, que pode ter dabs duros pós-feather).
    const eff = smooth > 0 ? featherMask(baseMask, width, height, smooth) : baseMask;
    const before = new Uint8ClampedArray(original.data);
    const after = new Uint8ClampedArray(original.data);
    // ORDEM OBRIGATÓRIA: descontaminar ANTES de aplicar o alpha. A correção lê
    // os RGB dos vizinhos transparentes pra estimar o fundo velho, e é o
    // applyMaskAlpha (que só multiplica alpha) que os mantém legíveis — depois
    // dele os pixels seguem lá, mas invisíveis, e a estimativa já foi feita.
    if (decontam > 0) decontaminateEdge(after, eff, width, height, searchRadius(decontam, smooth));
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
