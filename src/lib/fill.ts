/** Balde de tinta — flood fill scanline PURO sobre os bytes do ImageData.
 *
 *  Scanline e não recursivo/pilha-de-pixels: preencher uma área de 4096²
 *  empilharia milhões de frames (estouro) ou milhões de pushes (lento). O
 *  scanline anda por SEGMENTOS horizontais — ordens de grandeza menos entradas
 *  na pilha e acesso à memória sequencial (cache-friendly).
 *
 *  O bitmap `visited` não é otimização, é CORREÇÃO: quando a cor de
 *  preenchimento cai DENTRO da tolerância da cor alvo, o pixel recém-pintado
 *  continuaria "casando" e o algoritmo repintaria pra sempre. Visitado não
 *  volta, e pronto.
 *
 *  Puro de propósito: recebe `Uint8ClampedArray` e devolve o dirty-rect. Roda
 *  em Node no vitest sem canvas.
 */

import { dist2, type Rgba } from "./color";
import type { Rect } from "./geometry";

/**
 * Preenche em-lugar a partir de (sx, sy). Devolve o retângulo tocado, ou null
 * se nada mudou (clique fora do doc, ou a cor alvo já é exatamente a pedida).
 *
 * `tolerance` 0..255: 0 = só a cor exata; maior = aceita vizinhança de cor
 * (métrica: distância euclidiana RGBA comparada ao quadrado — ver color.ts).
 */
export function floodFill(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  sx: number,
  sy: number,
  color: Rgba,
  tolerance = 0,
): Rect | null {
  sx = Math.floor(sx);
  sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;

  const i0 = (sy * w + sx) * 4;
  const tr = data[i0];
  const tg = data[i0 + 1];
  const tb = data[i0 + 2];
  const ta = data[i0 + 3];

  // Já é a cor pedida: preencher seria um no-op que ainda sujaria o undo.
  if (tr === color.r && tg === color.g && tb === color.b && ta === color.a) return null;

  // Tolerância ao quadrado uma vez; `dist2` não tira raiz nunca. O ×4 é o
  // número de canais (pior caso da soma: 4·255²).
  const tol2 = tolerance * tolerance * 4;

  const visited = new Uint8Array(w * h);

  /** Casa = dentro da tolerância E nunca pintado (ver doc do módulo). */
  const match = (px: number, py: number): boolean => {
    const p = py * w + px;
    if (visited[p]) return false;
    const i = p * 4;
    return dist2(data[i], data[i + 1], data[i + 2], data[i + 3], tr, tg, tb, ta) <= tol2;
  };

  const paint = (px: number, py: number) => {
    const p = py * w + px;
    visited[p] = 1;
    const i = p * 4;
    data[i] = color.r;
    data[i + 1] = color.g;
    data[i + 2] = color.b;
    data[i + 3] = color.a;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  };

  let minX = sx;
  let maxX = sx;
  let minY = sy;
  let maxY = sy;

  // Pilha de spans [x1, x2, y, dy] — algoritmo clássico de span filling.
  const stack: number[] = [sx, sx, sy, 1, sx, sx, sy - 1, -1];

  while (stack.length > 0) {
    const dy = stack.pop() as number;
    const y = stack.pop() as number;
    let x2 = stack.pop() as number;
    let x1 = stack.pop() as number;
    if (y < 0 || y >= h) continue;

    let x = x1;
    // Estende (pintando) pra esquerda do começo do span pai.
    if (match(x, y)) {
      while (x > 0 && match(x - 1, y)) {
        paint(x - 1, y);
        x--;
      }
      if (x < x1) stack.push(x, x1 - 1, y - dy, -dy);
    }

    while (x1 <= x2) {
      while (x1 < w && match(x1, y)) {
        paint(x1, y);
        x1++;
      }
      if (x1 > x) stack.push(x, x1 - 1, y + dy, dy);
      if (x1 - 1 > x2) stack.push(x2 + 1, x1 - 1, y - dy, -dy);
      x1++;
      while (x1 <= x2 && !match(x1, y)) x1++;
      x = x1;
    }
  }

  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
