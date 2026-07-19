/** Máscara de seleção — a plataforma por trás de varinha/laço/inverter.
 *
 *  Convenção (a mesma do estado de seleção): uma seleção é
 *  `{ bounds: Rect, mask: Uint8Array | null }` com a máscara RELATIVA ao
 *  bounds (byte por pixel, 0/1, linha por linha). `mask === null` significa
 *  "retângulo cheio" — é o fast path que mantém TUDO que existia antes
 *  (marquee, clip retangular, lift/stamp) byte a byte igual.
 *
 *  Tudo aqui é puro (Uint8Array/Uint8ClampedArray, sem canvas) de propósito:
 *  a interação máscara × flutuante × undo é a parte mais sutil do app, e a
 *  suíte de testes desta plataforma roda em Node ANTES de qualquer ferramenta
 *  visível existir.
 */

import { unionRect, type Rect } from "./geometry";

export interface MaskSel {
  bounds: Rect;
  /** Relativa ao bounds (bounds.w * bounds.h bytes). null = retângulo cheio. */
  mask: Uint8Array | null;
}

/** Máscara toda 1 — materializa o "retângulo cheio" quando uma operação de
 *  bits precisa de bytes de verdade. */
export function rectMask(w: number, h: number): Uint8Array {
  return new Uint8Array(w * h).fill(1);
}

/** Encolhe pro bbox justo dos bits ligados. Devolve null se a máscara está
 *  vazia; devolve `mask: null` se o recorte ficou TODO ligado (volta pro fast
 *  path de retângulo — importante: varinha em área uniforme = seleção rect). */
export function trimMask(bounds: Rect, mask: Uint8Array): MaskSel | null {
  const { w, h } = bounds;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (mask[row + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const tw = maxX - minX + 1;
  const th = maxY - minY + 1;
  const out = new Uint8Array(tw * th);
  let full = true;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const v = mask[(minY + y) * w + (minX + x)];
      out[y * tw + x] = v;
      if (!v) full = false;
    }
  }
  return {
    bounds: { x: bounds.x + minX, y: bounds.y + minY, w: tw, h: th },
    mask: full ? null : out,
  };
}

/** União (OR) de duas seleções — o Shift+clique da varinha. O bounds é a
 *  união dos retângulos; se o resultado cobrir tudo, volta pro fast path. */
export function unionSel(a: MaskSel, b: MaskSel): MaskSel {
  const bounds = unionRect(a.bounds, b.bounds)!;
  const { w, h } = bounds;
  const out = new Uint8Array(w * h);
  const blit = (s: MaskSel) => {
    const ox = s.bounds.x - bounds.x;
    const oy = s.bounds.y - bounds.y;
    for (let y = 0; y < s.bounds.h; y++) {
      const src = y * s.bounds.w;
      const dst = (oy + y) * w + ox;
      for (let x = 0; x < s.bounds.w; x++) {
        if (!s.mask || s.mask[src + x]) out[dst + x] = 1;
      }
    }
  };
  blit(a);
  blit(b);
  // trim também decide se virou retângulo cheio (mask null).
  return trimMask(bounds, out)!;
}

/** Inverte a seleção dentro do documento. Devolve null quando a inversão dá
 *  vazio (a seleção cobria o doc inteiro). Com máscara isso é trivial — flip
 *  de bytes — e é exatamente por isso que a plataforma paga a si mesma. */
export function invertSel(sel: MaskSel, docW: number, docH: number): MaskSel | null {
  const out = new Uint8Array(docW * docH).fill(1);
  const bx = Math.max(0, sel.bounds.x);
  const by = Math.max(0, sel.bounds.y);
  const bx2 = Math.min(docW, sel.bounds.x + sel.bounds.w);
  const by2 = Math.min(docH, sel.bounds.y + sel.bounds.h);
  for (let y = by; y < by2; y++) {
    for (let x = bx; x < bx2; x++) {
      const inside = sel.mask
        ? sel.mask[(y - sel.bounds.y) * sel.bounds.w + (x - sel.bounds.x)]
        : 1;
      if (inside) out[y * docW + x] = 0;
    }
  }
  return trimMask({ x: 0, y: 0, w: docW, h: docH }, out);
}

/** Zera o RGBA dos pixels FORA da máscara — é o que transforma a cópia do
 *  bounds no conteúdo do flutuante (lift mascarado copia só onde mask=1). */
export function applyMaskAlpha(data: Uint8ClampedArray, mask: Uint8Array): void {
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) {
      const i = p * 4;
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 0;
    }
  }
}

/** Zera o RGBA dos pixels DENTRO da máscara — a origem depois do lift, e o
 *  Delete mascarado. Complementar exato do applyMaskAlpha por construção. */
export function clearMasked(data: Uint8ClampedArray, mask: Uint8Array): void {
  for (let p = 0; p < mask.length; p++) {
    if (mask[p]) {
      const i = p * 4;
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 0;
    }
  }
}

/** Segmentos de borda da máscara (coordenadas LOCAIS, em unidades de pixel):
 *  cada aresta entre um pixel dentro e um fora, com colineares mesclados.
 *  Vira o Path2D das marching ants — traçar o CONTORNO real da seleção, não o
 *  bbox. Formato [x0, y0, x1, y1]; horizontais primeiro, depois verticais. */
export function maskOutline(mask: Uint8Array, w: number, h: number): [number, number, number, number][] {
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x];
  const segs: [number, number, number, number][] = [];

  // Arestas horizontais: na linha y (0..h), onde cima(y-1) difere de baixo(y).
  for (let y = 0; y <= h; y++) {
    let run = -1;
    for (let x = 0; x <= w; x++) {
      const edge = x < w && at(x, y - 1) !== at(x, y);
      if (edge && run < 0) run = x;
      if (!edge && run >= 0) {
        segs.push([run, y, x, y]);
        run = -1;
      }
    }
  }
  // Arestas verticais: na coluna x (0..w), onde esquerda(x-1) difere de direita(x).
  for (let x = 0; x <= w; x++) {
    let run = -1;
    for (let y = 0; y <= h; y++) {
      const edge = y < h && at(x - 1, y) !== at(x, y);
      if (edge && run < 0) run = y;
      if (!edge && run >= 0) {
        segs.push([x, run, x, y]);
        run = -1;
      }
    }
  }
  return segs;
}

/** Retângulos dos runs horizontais da máscara (coordenadas locais) — viram o
 *  Path2D de CLIP da pintura (fill nonzero de retângulos cobre a região).
 *  Runs iguais em linhas consecutivas são mesclados verticalmente pra reduzir
 *  a fragmentação do path (o risco medido da análise). */
export function maskRunRects(mask: Uint8Array, w: number, h: number): Rect[] {
  // 1 — runs por linha.
  const rows: { x: number; w: number }[][] = [];
  for (let y = 0; y < h; y++) {
    const runs: { x: number; w: number }[] = [];
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const on = x < w && mask[y * w + x];
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        runs.push({ x: start, w: x - start });
        start = -1;
      }
    }
    rows.push(runs);
  }
  // 2 — mescla vertical de runs idênticos em linhas consecutivas.
  const out: Rect[] = [];
  const open = new Map<string, Rect>();
  for (let y = 0; y < h; y++) {
    const next = new Map<string, Rect>();
    for (const r of rows[y]) {
      const key = `${r.x}:${r.w}`;
      const prev = open.get(key);
      if (prev && prev.y + prev.h === y) {
        prev.h += 1;
        next.set(key, prev);
      } else {
        const rect = { x: r.x, y, w: r.w, h: 1 };
        out.push(rect);
        next.set(key, rect);
      }
    }
    open.clear();
    for (const [k, v] of next) open.set(k, v);
  }
  return out;
}

/** Quantos pixels a máscara liga — pros testes e pra decidir "cobriu tudo". */
export function countMask(mask: Uint8Array): number {
  let n = 0;
  for (let p = 0; p < mask.length; p++) if (mask[p]) n++;
  return n;
}
