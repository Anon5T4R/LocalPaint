/** Modo "pintar a máscara" do remover objeto (fatia ⑦) — estado e buffers.
 *
 *  O PORQUÊ (pedido do João): a v0.9.0/v0.10.0 tira a máscara da SELEÇÃO, e
 *  objeto real quase nunca tem formato de retângulo, laço ou de uma amostra de
 *  cor. O padrão da indústria pra inpainting é pincelar POR CIMA do que se quer
 *  apagar — grosseiramente, porque o modelo tolera folga (e o `removeObject`
 *  ainda dilata 6 px). Este modo é esse pincel.
 *
 *  Continuidade com o que já existe, não substituição: se há seleção ativa
 *  quando o modo começa, ela entra como máscara INICIAL e o pincel só refina.
 *  É literalmente o "seletor pra servir de guia" — varinha faz o grosso, mão
 *  ajusta. Sem seleção, começa vazia.
 *
 *  Diferença estrutural pro modo Refinar (por que os dois stores não viraram
 *  um): lá a máscara É o alpha da camada e o canvas da camada fica emprestado
 *  pro preview; aqui a máscara é INSTRUÇÃO pro modelo — nenhum pixel do
 *  documento muda até o LaMa rodar, e o feedback é só um véu por cima. O que
 *  os dois de fato compartilham (dab, interpolação, véu) mora no
 *  `lib/maskpaint.ts` e é importado pelos dois.
 *
 *  A máscara é TRANSITÓRIA: não vira seleção do documento. A seleção que
 *  serviu de guia continua exatamente como estava — se o resultado não prestar,
 *  Ctrl+Z e o guia ainda está lá pra tentar de novo. Promover a pintura a
 *  seleção destruiria esse ponto de retorno em troca de nada (a máscara já
 *  cumpriu a função dela no instante em que o modelo rodou).
 *
 *  Buffers moram FORA do zustand (mesma razão das camadas e do refino: array
 *  grande mutável não é estado imutável). O store guarda só os knobs e o
 *  contador de pixels pintados.
 */

import { create } from "zustand";

import { requestRender } from "../lib/layers";
import type { Rect } from "../lib/geometry";
import type { MaskSel } from "../lib/mask";
import { countMaskOver, maskToSel, overlayRectRgba, paintMaskDab, selToMask } from "../lib/maskpaint";
import { VEIL_RGB } from "../lib/refine";
import { useDoc } from "./doc";

/** Máscara 0–255 do tamanho do DOC. 255 = buraco (o que vai sumir). */
let mask: Uint8ClampedArray | null = null;
let overlay: HTMLCanvasElement | null = null;
let docW = 0;
let docH = 0;

/** Véu mais opaco que o do Refinar (0,55 contra 0,45): lá ele é opcional e
 *  compete com o checkerboard; aqui ele é a ÚNICA prova visual do que vai
 *  sumir, e precisa ler bem por cima de foto colorida. */
const VEIL_ALPHA = 0.55;

export function getObjMaskCanvas(): HTMLCanvasElement | null {
  return overlay;
}

/** A máscara crua — a ponte `__lp` mede por aqui nas provas de GUI. */
export function getObjMaskBuffer(): Uint8ClampedArray | null {
  return mask;
}

/** A máscara pintada na convenção do mask.ts, pronta pro `removeObject`.
 *  null quando nada foi pintado. Depois desta função o caminho é o MESMO da
 *  seleção — mesma dilatação, mesma janela de recorte, mesmo worker. */
export function getObjMaskSel(): MaskSel | null {
  if (!mask) return null;
  return maskToSel(mask, docW, docH);
}

function repaintOverlay(r: Rect): void {
  if (!mask || !overlay) return;
  overlay
    .getContext("2d")!
    .putImageData(new ImageData(overlayRectRgba(mask, docW, r, { ...VEIL_RGB, a: VEIL_ALPHA }, false), r.w, r.h), r.x, r.y);
}

function drop(): void {
  mask = null;
  overlay = null;
  docW = 0;
  docH = 0;
}

export type ObjMaskMode = "paint" | "erase";

interface ObjMaskState {
  active: boolean;
  mode: ObjMaskMode;
  /** Pixels acima do limiar — habilita o Aplicar e é a métrica das provas. */
  painted: number;
  /** Aplicar foi pedido: o App abre o modal do LaMa. Os buffers seguem VIVOS
   *  até `finish()` — é deles que o modal tira a máscara. */
  armed: boolean;

  /** Entra no modo. `seed` é a seleção ativa (ou null pra começar vazio). */
  start: (seed: MaskSel | null) => void;
  setMode: (m: ObjMaskMode) => void;
  /** Um toque do pincel em coordenada de DOC (o CanvasStage interpola). */
  paintAt: (x: number, y: number, radius: number, erase: boolean) => void;
  /** Fim do traço: recontagem (cara demais pra rodar dab a dab). */
  endStroke: () => void;
  /** Pede o Aplicar. No-op com máscara vazia — não há o que mandar pro modelo. */
  arm: () => void;
  /** O modal terminou (aplicou, falhou ou foi cancelado): larga os buffers. */
  finish: () => void;
  /** Sai sem tocar a imagem nem o histórico. */
  cancel: () => void;
}

export const useObjMask = create<ObjMaskState>((set, get) => ({
  active: false,
  mode: "paint",
  painted: 0,
  armed: false,

  start: (seed) => {
    const doc = useDoc.getState();
    if (!doc.open) return;
    docW = doc.width;
    docH = doc.height;
    mask = seed ? selToMask(seed, docW, docH) : new Uint8ClampedArray(docW * docH);
    overlay = document.createElement("canvas");
    overlay.width = docW;
    overlay.height = docH;
    repaintOverlay({ x: 0, y: 0, w: docW, h: docH });
    set({ active: true, mode: "paint", armed: false, painted: countMaskOver(mask) });
    requestRender();
  },

  setMode: (mode) => set({ mode }),

  paintAt: (x, y, radius, erase) => {
    if (!get().active || !mask) return;
    const r = paintMaskDab(mask, docW, docH, x, y, radius, !erase);
    if (r) {
      repaintOverlay(r);
      requestRender();
    }
  },

  endStroke: () => {
    if (!get().active || !mask) return;
    set({ painted: countMaskOver(mask) });
  },

  arm: () => {
    const { active, painted } = get();
    if (!active || painted === 0) return;
    set({ armed: true });
  },

  finish: () => {
    drop();
    set({ active: false, armed: false, painted: 0 });
    requestRender();
  },

  cancel: () => {
    if (!get().active) return;
    drop();
    set({ active: false, armed: false, painted: 0 });
    requestRender();
  },
}));
