/** Balde de tinta e varinha mágica — flood fill scanline PURO sobre bytes.
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
 *  O MESMO scanline serve dois clientes (a generalização da fatia F2/F3):
 *  - `floodFill` — o balde: match e paint no mesmo buffer RGBA.
 *  - `floodFillSelect` — a varinha: match num buffer READ-ONLY (tipicamente o
 *    composto, sample-merged) e paint escrevendo `mask[p]=1`. O `visited` do
 *    balde JÁ ERA essa máscara — aqui ela vira o produto.
 *
 *  Puro de propósito: recebe `Uint8ClampedArray` e devolve dirty-rect/máscara.
 *  Roda em Node no vitest sem canvas.
 */

import { dist2, type Rgba } from "./color";
import type { Rect } from "./geometry";
import type { MaskSel } from "./mask";

/** O núcleo scanline (span filling clássico), parametrizado por match/paint.
 *  `match` NÃO pode devolver true pra um pixel já pintado (é o contrato que o
 *  visited dos chamadores cumpre) — senão, loop infinito. */
function spanFill(
  w: number,
  h: number,
  sx: number,
  sy: number,
  match: (x: number, y: number) => boolean,
  paint: (x: number, y: number) => void,
): void {
  // Pilha de spans [x1, x2, y, dy].
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
}

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

  let minX = sx;
  let maxX = sx;
  let minY = sy;
  let maxY = sy;

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

  spanFill(w, h, sx, sy, match, paint);

  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * A varinha: mesmo scanline e MESMA métrica de tolerância do balde, mas o
 * buffer é read-only e o produto é uma MÁSCARA (recortada pro bounds justo,
 * convenção de lib/mask.ts). A máscara pode sair toda-1 (região uniforme) —
 * o chamador passa por trimMask, que degenera isso pro fast path `mask: null`
 * (retângulo puro); o bounds já sai justo do próprio flood.
 *
 * Diferença deliberada do balde: NÃO tem o no-op de "já é a cor" — selecionar
 * uma região da cor X é sempre válido; o mínimo devolvido é o pixel clicado.
 */
export function floodFillSelect(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  sx: number,
  sy: number,
  tolerance = 0,
): MaskSel | null {
  sx = Math.floor(sx);
  sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;

  const i0 = (sy * w + sx) * 4;
  const tr = data[i0];
  const tg = data[i0 + 1];
  const tb = data[i0 + 2];
  const ta = data[i0 + 3];
  const tol2 = tolerance * tolerance * 4;

  // O visited É a máscara (bit ligado = selecionado) — de graça.
  const mask = new Uint8Array(w * h);

  const match = (px: number, py: number): boolean => {
    const p = py * w + px;
    if (mask[p]) return false;
    const i = p * 4;
    return dist2(data[i], data[i + 1], data[i + 2], data[i + 3], tr, tg, tb, ta) <= tol2;
  };

  let minX = sx;
  let maxX = sx;
  let minY = sy;
  let maxY = sy;

  const paint = (px: number, py: number) => {
    mask[py * w + px] = 1;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  };

  // O pixel de partida sempre casa consigo mesmo (dist 0 ≤ tol²) — o flood
  // pinta pelo menos ele; não há resultado vazio com clique dentro do doc.
  spanFill(w, h, sx, sy, match, paint);

  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const cropped = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      cropped[y * bw + x] = mask[(minY + y) * w + (minX + x)];
    }
  }
  return { bounds: { x: minX, y: minY, w: bw, h: bh }, mask: cropped };
}
