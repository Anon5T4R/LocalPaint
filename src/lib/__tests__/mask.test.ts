import { describe, expect, it } from "vitest";

import { floodFillSelect } from "../fill";
import type { Rect } from "../geometry";
import {
  applyMaskAlpha,
  clearMasked,
  countMask,
  invertSel,
  maskOutline,
  maskRunRects,
  rectMask,
  trimMask,
  unionSel,
  type MaskSel,
} from "../mask";

/** Máscara legível: linhas de '.'/'#' — a grade É o caso, como no fill.test. */
function m(rows: string[]): { mask: Uint8Array; w: number; h: number } {
  const h = rows.length;
  const w = rows[0].length;
  const mask = new Uint8Array(w * h);
  rows.forEach((row, y) => [...row].forEach((ch, x) => (mask[y * w + x] = ch === "#" ? 1 : 0)));
  return { mask, w, h };
}

function render(sel: MaskSel): string[] {
  const out: string[] = [];
  for (let y = 0; y < sel.bounds.h; y++) {
    let row = "";
    for (let x = 0; x < sel.bounds.w; x++) {
      row += !sel.mask || sel.mask[y * sel.bounds.w + x] ? "#" : ".";
    }
    out.push(row);
  }
  return out;
}

const B = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

describe("trimMask", () => {
  it("encolhe pro bbox justo e preserva o offset do bounds", () => {
    const { mask } = m(["....", ".##.", ".#..", "...."]);
    const sel = trimMask(B(10, 20, 4, 4), mask)!;
    expect(sel.bounds).toEqual(B(11, 21, 2, 2));
    expect(render(sel)).toEqual(["##", "#."]);
  });

  it("máscara cheia degenera pro fast path (mask null = retângulo puro)", () => {
    const sel = trimMask(B(3, 4, 3, 2), rectMask(3, 2))!;
    expect(sel.bounds).toEqual(B(3, 4, 3, 2));
    expect(sel.mask).toBeNull();
  });

  it("máscara vazia = null (seleção não existe)", () => {
    expect(trimMask(B(0, 0, 3, 3), new Uint8Array(9))).toBeNull();
  });
});

describe("unionSel (Shift+clique da varinha)", () => {
  it("soma duas máscaras com bounds deslocados", () => {
    const a: MaskSel = { bounds: B(0, 0, 2, 2), mask: m(["#.", ".#"]).mask };
    const b: MaskSel = { bounds: B(1, 1, 2, 2), mask: m(["#.", ".#"]).mask };
    const u = unionSel(a, b);
    expect(u.bounds).toEqual(B(0, 0, 3, 3));
    expect(render(u)).toEqual(["#..", ".#.", "..#"]);
    expect(countMask(u.mask!)).toBe(3); // o (1,1) é compartilhado — OR, não soma
  });

  it("retângulo (mask null) entra como cheio", () => {
    const a: MaskSel = { bounds: B(0, 0, 2, 2), mask: null };
    const b: MaskSel = { bounds: B(2, 0, 1, 2), mask: null };
    const u = unionSel(a, b);
    // Dois retângulos adjacentes que cobrem o bounds inteiro → volta a ser rect.
    expect(u.bounds).toEqual(B(0, 0, 3, 2));
    expect(u.mask).toBeNull();
  });

  it("união disjunta mantém máscara com buraco no meio", () => {
    const a: MaskSel = { bounds: B(0, 0, 1, 1), mask: null };
    const b: MaskSel = { bounds: B(2, 0, 1, 1), mask: null };
    const u = unionSel(a, b);
    expect(u.bounds).toEqual(B(0, 0, 3, 1));
    expect(render(u)).toEqual(["#.#"]);
  });
});

describe("invertSel", () => {
  it("inverter retângulo no meio do doc = doc inteiro menos o retângulo", () => {
    const inv = invertSel({ bounds: B(1, 1, 2, 2), mask: null }, 4, 4)!;
    expect(inv.bounds).toEqual(B(0, 0, 4, 4));
    expect(render(inv)).toEqual(["####", "#..#", "#..#", "####"]);
    expect(countMask(inv.mask!)).toBe(12);
  });

  it("inverter a seleção do doc inteiro = vazio (null)", () => {
    expect(invertSel({ bounds: B(0, 0, 3, 3), mask: null }, 3, 3)).toBeNull();
  });

  it("inverter duas vezes volta à seleção original (com bounds justo)", () => {
    const orig: MaskSel = { bounds: B(1, 1, 2, 1), mask: m(["#."]).mask };
    const twice = invertSel(invertSel(orig, 4, 4)!, 4, 4)!;
    expect(twice.bounds).toEqual(B(1, 1, 1, 1));
    expect(twice.mask).toBeNull(); // 1 pixel = retângulo cheio
  });

  it("inverter encosta na borda: bounds encolhe pro que sobrou", () => {
    // Seleção = coluna esquerda inteira → inverso = colunas 1..2.
    const inv = invertSel({ bounds: B(0, 0, 1, 3), mask: null }, 3, 3)!;
    expect(inv.bounds).toEqual(B(1, 0, 2, 3));
    expect(inv.mask).toBeNull();
  });
});

describe("applyMaskAlpha / clearMasked (a semântica do lift mascarado)", () => {
  it("flutuante + origem limpa recompõem exatamente o original (partição)", () => {
    const { mask } = m(["#.", ".#"]);
    const orig = new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    const float = new Uint8ClampedArray(orig);
    const origin = new Uint8ClampedArray(orig);
    applyMaskAlpha(float, mask); // fica só onde mask=1
    clearMasked(origin, mask); // fica só onde mask=0
    // Pixel a pixel: um dos dois é zero e a soma devolve o original.
    for (let i = 0; i < orig.length; i++) {
      expect(float[i] === 0 || origin[i] === 0).toBe(true);
      expect(float[i] + origin[i]).toBe(orig[i]);
    }
  });

  it("clearMasked zera SÓ os pixels da máscara (Delete mascarado)", () => {
    const { mask } = m(["##", ".."]);
    const data = new Uint8ClampedArray(16).fill(200);
    clearMasked(data, mask);
    expect([...data.slice(0, 8)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect([...data.slice(8)]).toEqual(Array(8).fill(200));
  });
});

describe("maskOutline (as formigas de verdade)", () => {
  const perimeter = (segs: [number, number, number, number][]) =>
    segs.reduce((n, [x0, y0, x1, y1]) => n + Math.abs(x1 - x0) + Math.abs(y1 - y0), 0);

  it("um pixel = 4 segmentos de comprimento 1", () => {
    const { mask, w, h } = m(["#"]);
    const segs = maskOutline(mask, w, h);
    expect(segs).toHaveLength(4);
    expect(perimeter(segs)).toBe(4);
  });

  it("run 2×1 = 4 segmentos mesclados (colineares não fragmentam)", () => {
    const { mask, w, h } = m(["##"]);
    const segs = maskOutline(mask, w, h);
    expect(segs).toHaveLength(4);
    expect(perimeter(segs)).toBe(6); // 2+2 horizontais, 1+1 verticais
  });

  it("anel (donut) tem contorno externo E interno", () => {
    const { mask, w, h } = m(["###", "#.#", "###"]);
    const segs = maskOutline(mask, w, h);
    // Externo: 4 arestas de 3. Interno (o buraco): 4 arestas de 1.
    expect(perimeter(segs)).toBe(12 + 4);
    expect(segs).toHaveLength(8);
  });

  it("diagonal: cada pixel contribui o próprio contorno (sem vazamento)", () => {
    const { mask, w, h } = m(["#.", ".#"]);
    const segs = maskOutline(mask, w, h);
    expect(perimeter(segs)).toBe(8);
  });
});

describe("maskRunRects (o clip da pintura)", () => {
  const area = (rects: Rect[]) => rects.reduce((n, r) => n + r.w * r.h, 0);

  it("runs iguais em linhas consecutivas mesclam verticalmente", () => {
    const { mask, w, h } = m(["##", "##", "##"]);
    const rects = maskRunRects(mask, w, h);
    expect(rects).toEqual([{ x: 0, y: 0, w: 2, h: 3 }]);
  });

  it("cobre exatamente a área da máscara (sem sobrepor nem vazar)", () => {
    const { mask, w, h } = m(["##..", "###.", "..##"]);
    const rects = maskRunRects(mask, w, h);
    expect(area(rects)).toBe(countMask(mask));
    // Reconstrói e compara byte a byte.
    const back = new Uint8Array(w * h);
    for (const r of rects)
      for (let y = r.y; y < r.y + r.h; y++)
        for (let x = r.x; x < r.x + r.w; x++) back[y * w + x] = 1;
    expect([...back]).toEqual([...mask]);
  });
});

describe("floodFillSelect (o motor da varinha)", () => {
  /** RGBA de linhas '.'/letra, igual ao fill.test. */
  function grid(rows: string[]): { data: Uint8ClampedArray; w: number; h: number } {
    const COLORS: Record<string, [number, number, number, number]> = {
      ".": [0, 0, 0, 0],
      "#": [0, 0, 0, 255],
      r: [255, 0, 0, 255],
      n: [250, 5, 5, 255],
    };
    const h = rows.length;
    const w = rows[0].length;
    const data = new Uint8ClampedArray(w * h * 4);
    rows.forEach((row, y) =>
      [...row].forEach((ch, x) => data.set(COLORS[ch], (y * w + x) * 4)),
    );
    return { data, w, h };
  }

  it("devolve máscara com bounds justo e NÃO toca o buffer de leitura", () => {
    const { data, w, h } = grid(["....", ".rr.", ".r#.", "...."]);
    const before = [...data];
    const sel = floodFillSelect(data, w, h, 1, 1)!;
    expect([...data]).toEqual(before); // read-only de verdade
    expect(sel.bounds).toEqual({ x: 1, y: 1, w: 2, h: 2 });
    expect(render(sel as MaskSel)).toEqual(["##", "#."]); // o '#' escapa
  });

  it("mesma métrica de tolerância do balde ('n' entra com 12, não com 0)", () => {
    const { data, w, h } = grid(["rn", "nr"]);
    const strict = floodFillSelect(data, w, h, 0, 0, 0)!;
    expect(countMask(strict.mask!)).toBe(1);
    const loose = floodFillSelect(data, w, h, 0, 0, 12)!;
    expect(loose.bounds).toEqual({ x: 0, y: 0, w: 2, h: 2 });
    expect(countMask(loose.mask!)).toBe(4);
  });

  it("região uniforme seleciona a grade inteira (trim degenera pra rect depois)", () => {
    const { data, w, h } = grid(["rr", "rr"]);
    const sel = floodFillSelect(data, w, h, 0, 0)!;
    expect(sel.bounds).toEqual({ x: 0, y: 0, w: 2, h: 2 });
    expect(countMask(sel.mask!)).toBe(4);
    expect(trimMask(sel.bounds, sel.mask!)!.mask).toBeNull();
  });

  it("clique fora do doc = null; selecionar 1 pixel isolado funciona", () => {
    const { data, w, h } = grid(["r."]);
    expect(floodFillSelect(data, w, h, -1, 0)).toBeNull();
    expect(floodFillSelect(data, w, h, 0, 9)).toBeNull();
    const one = floodFillSelect(data, w, h, 0, 0)!;
    expect(one.bounds).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(countMask(one.mask!)).toBe(1);
  });

  it("diagonal não conecta (conectividade-4, igual ao balde)", () => {
    const { data, w, h } = grid(["r.", ".r"]);
    const sel = floodFillSelect(data, w, h, 0, 0, 0)!;
    expect(sel.bounds).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});
