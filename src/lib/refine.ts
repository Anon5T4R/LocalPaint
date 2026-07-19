/** Matemática PURA do modo Refinar da remoção de fundo (fatia ③).
 *
 *  Convenção: máscara 0–255 (a do matte.ts — alpha contínuo), NÃO a 0/1 do
 *  mask.ts (seleção binária). Os dois tipos não se misturam de propósito —
 *  ver análise §4.1: o refino vive só durante o modo e morre no Aplicar.
 *
 *  Tudo aqui é Uint8ClampedArray sem canvas — testável em Node no vitest.
 *  A "suavidade do pincel" é a borda anti-aliased de ~1px do dab (o pincel
 *  do app não tem dureza configurável; a suavização de verdade é o blur da
 *  máscara inteira, no slider).
 */

import type { Rect } from "./geometry";

/** Um toque circular do pincel na máscara. `restore` pinta em direção a 255
 *  (max — nunca escurece o que já estava restaurado), apagar pinta em direção
 *  a 0 (min). Cobertura com borda macia de ~1px. Devolve o dirty-rect tocado
 *  (coordenadas do doc), ou null se caiu inteiro fora. */
export function paintMaskDab(
  mask: Uint8ClampedArray,
  w: number,
  h: number,
  cx: number,
  cy: number,
  radius: number,
  restore: boolean,
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
      mask[p] = restore ? Math.max(mask[p], v) : Math.min(mask[p], 255 - v);
    }
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

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

/** RGBA do retângulo do VÉU: onde a máscara removeu (valor baixo), um véu
 *  vermelho semitransparente proporcional; onde manteve, nada. É o overlay
 *  opcional que mostra "o que a IA jogou fora" por cima do checkerboard. */
export function veilRectRgba(mask: Uint8ClampedArray, w: number, rect: Rect): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rect.w * rect.h * 4);
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const p = (rect.y + y) * w + rect.x + x;
      const o = (y * rect.w + x) * 4;
      out[o] = 255;
      out[o + 1] = 40;
      out[o + 2] = 70;
      out[o + 3] = Math.round((255 - mask[p]) * 0.45);
    }
  }
  return out;
}
