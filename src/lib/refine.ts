/** Matemática PURA do modo Refinar da remoção de fundo (fatia ③).
 *
 *  Convenção: máscara 0–255 (a do matte.ts — alpha contínuo), NÃO a 0/1 do
 *  mask.ts (seleção binária). Os dois tipos não se misturam de propósito —
 *  ver análise §4.1: o refino vive só durante o modo e morre no Aplicar.
 *
 *  O PINCEL não mora mais aqui: `paintMaskDab` migrou pro `maskpaint.ts` na
 *  fatia ⑦, quando o remover objeto passou a pintar máscara também. O que
 *  sobrou neste arquivo é o que é REALMENTE do refino — o blur da borda e a
 *  recomposição do preview (RGB original × máscara), que não fazem sentido
 *  num modo cuja máscara é instrução pro modelo e não altera pixel nenhum.
 *
 *  Tudo aqui é Uint8ClampedArray sem canvas — testável em Node no vitest.
 */

import type { Rect } from "./geometry";
import { overlayRectRgba } from "./maskpaint";

/** Box blur separável em UM canal (a mesma matemática do boxBlur dos filtros,
 *  sem RGBA nem premultiply — máscara não tem cor pra sangrar). 3 passadas ≈
 *  gaussiano; borda estendida. Devolve CÓPIA borrada — a base fica intacta
 *  (o slider re-borra sempre a partir da base, sem acumular). */
export function blurMask(mask: Uint8ClampedArray, w: number, h: number, radius: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(mask);
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return out;

  const n = w * h;
  const src = new Float32Array(n);
  for (let i = 0; i < n; i++) src[i] = mask[i];
  const tmp = new Float32Array(n);
  const passes = 3;
  const boxR = Math.max(1, Math.round(r / Math.sqrt(passes)));

  const blurAxis = (horizontal: boolean) => {
    const len = horizontal ? w : h;
    const lines = horizontal ? h : w;
    const stride = horizontal ? 1 : w;
    const lineStride = horizontal ? w : 1;
    const win = 2 * boxR + 1;
    for (let li = 0; li < lines; li++) {
      const base = li * lineStride;
      let sum = 0;
      for (let k = -boxR; k <= boxR; k++) {
        const idx = Math.min(len - 1, Math.max(0, k));
        sum += src[base + idx * stride];
      }
      for (let x = 0; x < len; x++) {
        tmp[base + x * stride] = sum / win;
        const outIdx = Math.max(0, x - boxR);
        const inIdx = Math.min(len - 1, x + boxR + 1);
        sum += src[base + inIdx * stride] - src[base + outIdx * stride];
      }
    }
    src.set(tmp.subarray(0, n));
  };

  for (let p = 0; p < passes; p++) {
    blurAxis(true);
    blurAxis(false);
  }
  for (let i = 0; i < n; i++) out[i] = src[i];
  return out;
}

/** RGBA do retângulo do preview: RGB do ORIGINAL, alpha = alphaOriginal ×
 *  máscara/255 (a multiplicação do matte — pixel meio-transparente não fica
 *  mais opaco por causa do refino). Não toca o original. */
export function composeRectRgba(
  orig: Uint8ClampedArray,
  mask: Uint8ClampedArray,
  w: number,
  rect: Rect,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rect.w * rect.h * 4);
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const p = (rect.y + y) * w + rect.x + x;
      const o = (y * rect.w + x) * 4;
      out[o] = orig[p * 4];
      out[o + 1] = orig[p * 4 + 1];
      out[o + 2] = orig[p * 4 + 2];
      out[o + 3] = Math.round((orig[p * 4 + 3] * mask[p]) / 255);
    }
  }
  return out;
}

/** Vermelho do véu — o convencional de máscara em editor de imagem. Mesmo tom
 *  nos dois modos de propósito: "vermelho translúcido = a IA mexe aqui". */
export const VEIL_RGB = { r: 255, g: 40, b: 70 } as const;

/** RGBA do retângulo do VÉU: onde a máscara removeu (valor baixo), um véu
 *  vermelho semitransparente proporcional; onde manteve, nada. É o overlay
 *  opcional que mostra "o que a IA jogou fora" por cima do checkerboard.
 *  INVERTIDO em relação ao véu do remover objeto — aqui máscara baixa é o
 *  buraco; lá o pintado é o buraco. Mesma função, direções opostas. */
export function veilRectRgba(mask: Uint8ClampedArray, w: number, rect: Rect): Uint8ClampedArray {
  return overlayRectRgba(mask, w, rect, { ...VEIL_RGB, a: 0.45 }, true);
}
