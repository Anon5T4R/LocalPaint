/** Pincelar MÁSCARA — a maquinaria compartilhada pelos dois modos que pintam
 *  uma máscara em vez de pintar pixels: o Refinar da remoção de fundo (v0.8.0)
 *  e o "pintar a máscara" do remover objeto (fatia ⑦).
 *
 *  Este módulo nasceu de uma EXTRAÇÃO, não de uma escrita nova: o dab e a
 *  interpolação do traço já existiam (em `refine.ts` e inline no CanvasStage) e
 *  foram movidos pra cá inteiros. A razão é a mesma que criou o `ort.ts` na
 *  v0.9.0 — duas cópias de "pinta um círculo macio numa máscara" divergem, e
 *  divergir aqui significa dois pincéis que se comportam diferente na mão do
 *  usuário pela mesma imagem.
 *
 *  O que NÃO é compartilhado, e por quê: o Refinar mostra o resultado
 *  RECOMPONDO o canvas da camada (a máscara é alpha, o preview é a imagem
 *  recortada); a máscara do remover objeto é uma INSTRUÇÃO pro modelo e não
 *  altera pixel nenhum — ela só ganha um véu por cima. As duas metades de
 *  composição são coisas diferentes de verdade; só a metade "pintar" é a mesma.
 *
 *  Convenção da máscara aqui: 0–255 (mesma do matte.ts), NÃO a 0/1 do mask.ts.
 *  A conversão pra seleção binária mora no `maskToSel` — é a fronteira única
 *  entre o pincel e o resto do app.
 */

import type { Rect } from "./geometry";
import { trimMask, type MaskSel } from "./mask";

/** Um toque circular do pincel na máscara. `up` pinta em direção a 255 (max —
 *  nunca desfaz o que já estava pintado dentro do mesmo traço), senão pinta em
 *  direção a 0 (min). Cobertura com borda macia de ~1px (o pincel do app não
 *  tem dureza configurável). Devolve o dirty-rect tocado (coordenadas do doc),
 *  ou null se o dab caiu inteiro fora. */
export function paintMaskDab(
  mask: Uint8ClampedArray,
  w: number,
  h: number,
  cx: number,
  cy: number,
  radius: number,
  up: boolean,
): Rect | null {
  const r = Math.max(0.5, radius);
  const x0 = Math.max(0, Math.floor(cx - r - 1));
  const y0 = Math.max(0, Math.floor(cy - r - 1));
  const x1 = Math.min(w - 1, Math.ceil(cx + r + 1));
  const y1 = Math.min(h - 1, Math.ceil(cy + r + 1));
  if (x1 < x0 || y1 < y0) return null;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const cov = Math.min(1, Math.max(0, r - d + 0.5));
      if (cov <= 0) continue;
      const p = y * w + x;
      const v = cov * 255;
      mask[p] = up ? Math.max(mask[p], v) : Math.min(mask[p], 255 - v);
    }
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Centros dos dabs de um segmento de traço, do ponto ANTERIOR (exclusivo) ao
 *  atual (inclusivo). Passo de meio raio: pointermove esparso não pode deixar
 *  buraco na máscara, e não há `getCoalescedEvents` que salve aqui (dab é caro
 *  — meio raio é denso o bastante e limita o custo). Sempre ≥ 1 ponto, então
 *  um clique parado ainda marca. */
export function strokePoints(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
): { x: number; y: number }[] {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(dist / Math.max(1, radius / 2)));
  const out: { x: number; y: number }[] = [];
  for (let i = 1; i <= steps; i++) {
    out.push({ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps });
  }
  return out;
}

export interface OverlayColor {
  r: number;
  g: number;
  b: number;
  /** Opacidade máxima do véu (0..1), atingida onde a máscara vale 255. */
  a: number;
}

/** RGBA do retângulo de um VÉU semitransparente derivado da máscara. Com
 *  `invert`, o véu aparece onde a máscara está BAIXA (é o véu do Refinar:
 *  "o que a IA jogou fora"); sem ele, aparece onde está ALTA (é o véu do
 *  remover objeto: "o que vai sumir"). Os dois véus são o mesmo desenho lido
 *  em direções opostas — daí um parâmetro em vez de duas funções. */
export function overlayRectRgba(
  mask: Uint8ClampedArray,
  w: number,
  rect: Rect,
  color: OverlayColor,
  invert: boolean,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rect.w * rect.h * 4);
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const p = (rect.y + y) * w + rect.x + x;
      const o = (y * rect.w + x) * 4;
      out[o] = color.r;
      out[o + 1] = color.g;
      out[o + 2] = color.b;
      out[o + 3] = Math.round((invert ? 255 - mask[p] : mask[p]) * color.a);
    }
  }
  return out;
}

/** Limiar da conversão pra seleção binária. 128 = metade da cobertura do dab:
 *  a borda anti-aliased de ~1px cai fora e a máscara sai crispada. Não vale a
 *  pena afinar isso — o `removeObject` ainda dilata 6 px por cima. */
export const MASK_ON = 128;

/** Máscara pintada (0–255, do tamanho do DOC) → seleção da convenção do
 *  mask.ts (bounds justo + máscara binária relativa a ele). É a fronteira
 *  única entre o pincel e o `removeObject` — depois daqui o caminho é o MESMO
 *  da seleção, byte a byte. Devolve null se nada foi pintado. */
export function maskToSel(mask: Uint8ClampedArray, w: number, h: number, threshold = MASK_ON): MaskSel | null {
  const bin = new Uint8Array(w * h);
  for (let p = 0; p < bin.length; p++) bin[p] = mask[p] >= threshold ? 1 : 0;
  return trimMask({ x: 0, y: 0, w, h }, bin);
}

/** Seleção → máscara pintável do tamanho do doc (255 dentro, 0 fora). É o
 *  "começar de uma seleção existente": a varinha faz o grosso, o pincel
 *  refina. Pixels do bounds fora do doc são ignorados (o clamp do store já
 *  garante que não acontece, mas a função é pura e não confia nisso). */
export function selToMask(sel: MaskSel, docW: number, docH: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(docW * docH);
  const { x, y, w, h } = sel.bounds;
  for (let j = 0; j < h; j++) {
    const dy = y + j;
    if (dy < 0 || dy >= docH) continue;
    for (let i = 0; i < w; i++) {
      const dx = x + i;
      if (dx < 0 || dx >= docW) continue;
      if (!sel.mask || sel.mask[j * w + i]) out[dy * docW + dx] = 255;
    }
  }
  return out;
}

/** Quantos pixels da máscara passam do limiar — a métrica das provas de GUI
 *  ("N traços marcaram X px, a borracha subtraiu Y"). */
export function countMaskOver(mask: Uint8ClampedArray, threshold = MASK_ON): number {
  let n = 0;
  for (let p = 0; p < mask.length; p++) if (mask[p] >= threshold) n++;
  return n;
}
