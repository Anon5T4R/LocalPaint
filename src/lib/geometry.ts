/** Geometria pura da pintura: retângulos, bbox de traço, Bresenham do lápis. */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Dois cantos (em qualquer ordem) → Rect normalizado. É o que as formas usam
 *  enquanto o usuário arrasta. */
export function normRect(x0: number, y0: number, x1: number, y1: number): Rect {
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    w: Math.abs(x1 - x0),
    h: Math.abs(y1 - y0),
  };
}

/** Interseção com o documento; null quando cai inteiro fora. Todo dirty-rect
 *  passa por aqui antes de virar getImageData — coordenada negativa no
 *  getImageData não dá erro, dá lixo silencioso. */
export function clampRect(r: Rect, w: number, h: number): Rect | null {
  const x = Math.max(0, Math.floor(r.x));
  const y = Math.max(0, Math.floor(r.y));
  const x2 = Math.min(w, Math.ceil(r.x + r.w));
  const y2 = Math.min(h, Math.ceil(r.y + r.h));
  if (x2 <= x || y2 <= y) return null;
  return { x, y, w: x2 - x, h: y2 - y };
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

/** Bbox de uma sequência de pontos engordada pelo raio do pincel (+1 de folga
 *  pro anti-alias — sem ela o undo devolve um halo de 1px do traço). */
export function strokeBbox(points: { x: number; y: number }[], radius: number): Rect | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const r = radius + 1;
  return { x: minX - r, y: minY - r, w: maxX - minX + 2 * r, h: maxY - minY + 2 * r };
}

/** Bresenham clássico — o LÁPIS pinta por aqui, pixel a pixel no ImageData,
 *  porque linha de canvas 2D é sempre anti-aliased e lápis de Paint tem que
 *  ser duro (pixel cheio ou nada). Devolve os pontos inclusive as pontas. */
export function bresenham(x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  let x = Math.round(x0);
  let y = Math.round(y0);
  const xEnd = Math.round(x1);
  const yEnd = Math.round(y1);
  const dx = Math.abs(xEnd - x);
  const dy = -Math.abs(yEnd - y);
  const sx = x < xEnd ? 1 : -1;
  const sy = y < yEnd ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    pts.push({ x, y });
    if (x === xEnd && y === yEnd) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return pts;
}

/** Segura Shift: quadrado/círculo perfeito (formas) — o lado vira o MENOR dos
 *  dois deltas, preservando a direção do arrasto. */
export function constrainSquare(x0: number, y0: number, x1: number, y1: number): { x1: number; y1: number } {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const side = Math.min(Math.abs(dx), Math.abs(dy));
  return { x1: x0 + Math.sign(dx || 1) * side, y1: y0 + Math.sign(dy || 1) * side };
}

/** Segura Shift na linha: tranca em 0/45/90°. */
export function constrainAngle(x0: number, y0: number, x1: number, y1: number): { x1: number; y1: number } {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const ang = Math.atan2(dy, dx);
  const step = Math.PI / 4;
  const snapped = Math.round(ang / step) * step;
  const len = Math.hypot(dx, dy);
  return { x1: x0 + Math.cos(snapped) * len, y1: y0 + Math.sin(snapped) * len };
}
