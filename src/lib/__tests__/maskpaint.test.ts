import { describe, expect, it } from "vitest";

import {
  countMaskOver,
  MASK_ON,
  maskToSel,
  overlayRectRgba,
  paintMaskDab,
  selToMask,
  strokePoints,
} from "../maskpaint";
import { countMask, rectMask } from "../mask";

const blank = (w: number, h: number) => new Uint8ClampedArray(w * h);

describe("paintMaskDab", () => {
  it("marca uma área próxima do círculo de raio r", () => {
    const m = blank(64, 64);
    paintMaskDab(m, 64, 64, 32, 32, 10, true);
    const n = countMaskOver(m);
    // πr² = 314; a borda macia entra e sai do limiar — 10% de folga.
    expect(n).toBeGreaterThan(280);
    expect(n).toBeLessThan(350);
  });

  it("centro fica em 255 e fora do dab fica em 0", () => {
    const m = blank(32, 32);
    paintMaskDab(m, 32, 32, 16, 16, 5, true);
    expect(m[16 * 32 + 16]).toBe(255);
    expect(m[0]).toBe(0);
  });

  it("dab repetido no mesmo lugar não cresce (max, não soma)", () => {
    const a = blank(32, 32);
    paintMaskDab(a, 32, 32, 16, 16, 6, true);
    const once = countMaskOver(a);
    paintMaskDab(a, 32, 32, 16, 16, 6, true);
    paintMaskDab(a, 32, 32, 16, 16, 6, true);
    expect(countMaskOver(a)).toBe(once);
  });

  it("apagar SUBTRAI o que foi pintado", () => {
    const m = blank(64, 64);
    paintMaskDab(m, 64, 64, 32, 32, 12, true);
    const cheio = countMaskOver(m);
    paintMaskDab(m, 64, 64, 32, 32, 6, false);
    const depois = countMaskOver(m);
    expect(depois).toBeLessThan(cheio);
    // O buraco tem ~π·6² = 113 px; o resto do dab grande sobrevive.
    expect(cheio - depois).toBeGreaterThan(90);
    expect(m[32 * 64 + 32]).toBe(0);
  });

  it("dab fora do buffer devolve null e não escreve nada", () => {
    const m = blank(16, 16);
    expect(paintMaskDab(m, 16, 16, -50, -50, 4, true)).toBeNull();
    expect(countMaskOver(m)).toBe(0);
  });

  it("dab na borda é clampado ao buffer (dirty-rect dentro)", () => {
    const m = blank(16, 16);
    const r = paintMaskDab(m, 16, 16, 0, 0, 5, true)!;
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.x + r.w).toBeLessThanOrEqual(16);
    expect(r.y + r.h).toBeLessThanOrEqual(16);
    expect(countMaskOver(m)).toBeGreaterThan(0);
  });
});

describe("strokePoints", () => {
  it("passo parado ainda dá um ponto (clique sem arrastar marca)", () => {
    const p = strokePoints(10, 10, 10, 10, 8);
    expect(p).toHaveLength(1);
    expect(p[0]).toEqual({ x: 10, y: 10 });
  });

  it("termina EXATAMENTE no ponto atual e não repete o anterior", () => {
    const p = strokePoints(0, 0, 100, 0, 10);
    expect(p[p.length - 1]).toEqual({ x: 100, y: 0 });
    expect(p[0]).not.toEqual({ x: 0, y: 0 });
  });

  it("espaça no máximo meio raio — traço não fica furado", () => {
    const p = strokePoints(0, 0, 200, 0, 20);
    let prev = { x: 0, y: 0 };
    for (const q of p) {
      expect(Math.hypot(q.x - prev.x, q.y - prev.y)).toBeLessThanOrEqual(10.001);
      prev = q;
    }
  });

  it("traço interpolado cobre o corredor todo (sem buracos entre dabs)", () => {
    const m = blank(128, 32);
    for (const q of strokePoints(10, 16, 110, 16, 6)) paintMaskDab(m, 128, 32, q.x, q.y, 6, true);
    // Toda coluna do miolo do traço tem que estar marcada na linha central.
    for (let x = 12; x <= 108; x++) expect(m[16 * 128 + x]).toBeGreaterThanOrEqual(MASK_ON);
  });
});

describe("maskToSel", () => {
  it("vazia devolve null (nada pra mandar pro modelo)", () => {
    expect(maskToSel(blank(32, 32), 32, 32)).toBeNull();
  });

  it("bounds justo ao que foi pintado, máscara relativa a ele", () => {
    const m = blank(64, 64);
    // Quadrado cheio de 4×4 em (10,20).
    for (let y = 20; y < 24; y++) for (let x = 10; x < 14; x++) m[y * 64 + x] = 255;
    const sel = maskToSel(m, 64, 64)!;
    expect(sel.bounds).toEqual({ x: 10, y: 20, w: 4, h: 4 });
    // Recorte todo ligado degenera pro fast path de retângulo (mask null).
    expect(sel.mask).toBeNull();
  });

  it("forma não-retangular vira máscara de verdade com a contagem certa", () => {
    const m = blank(64, 64);
    paintMaskDab(m, 64, 64, 32, 32, 9, true);
    const antes = countMaskOver(m);
    const sel = maskToSel(m, 64, 64)!;
    expect(sel.mask).not.toBeNull();
    expect(countMask(sel.mask!)).toBe(antes);
  });

  it("o limiar decide: valor abaixo dele não entra", () => {
    const m = blank(8, 8);
    m[0] = MASK_ON - 1;
    expect(maskToSel(m, 8, 8)).toBeNull();
    m[0] = MASK_ON;
    expect(maskToSel(m, 8, 8)!.bounds).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});

describe("selToMask", () => {
  it("retângulo cheio (mask null) vira bloco de 255", () => {
    const m = selToMask({ bounds: { x: 2, y: 3, w: 5, h: 4 }, mask: null }, 32, 32);
    expect(countMaskOver(m)).toBe(20);
    expect(m[3 * 32 + 2]).toBe(255);
    expect(m[2 * 32 + 2]).toBe(0);
  });

  it("seleção mascarada preserva a contagem exata", () => {
    const bin = rectMask(6, 6);
    bin[0] = 0;
    bin[35] = 0;
    const m = selToMask({ bounds: { x: 4, y: 4, w: 6, h: 6 }, mask: bin }, 32, 32);
    expect(countMaskOver(m)).toBe(34);
  });

  it("ida e volta (seleção → máscara → seleção) é fiel", () => {
    const bin = rectMask(7, 5);
    bin[0] = 0;
    bin[8] = 0;
    const sel = { bounds: { x: 3, y: 9, w: 7, h: 5 }, mask: bin };
    const back = maskToSel(selToMask(sel, 40, 40), 40, 40)!;
    expect(back.bounds).toEqual(sel.bounds);
    expect(countMask(back.mask!)).toBe(countMask(bin));
  });

  it("bounds saindo do doc é recortado, não estoura o buffer", () => {
    const m = selToMask({ bounds: { x: -2, y: -2, w: 6, h: 6 }, mask: null }, 8, 8);
    expect(m).toHaveLength(64);
    expect(countMaskOver(m)).toBe(16);
  });
});

describe("overlayRectRgba", () => {
  const rect = { x: 0, y: 0, w: 2, h: 1 };

  it("sem invert, o véu aparece onde a máscara está ALTA", () => {
    const m = new Uint8ClampedArray([255, 0]);
    const px = overlayRectRgba(m, 2, rect, { r: 255, g: 40, b: 70, a: 0.55 }, false);
    expect([px[0], px[1], px[2]]).toEqual([255, 40, 70]);
    expect(px[3]).toBe(140); // round(255 * 0.55)
    expect(px[7]).toBe(0);
  });

  it("com invert, é o espelho — é o véu do Refinar", () => {
    const m = new Uint8ClampedArray([255, 0]);
    const px = overlayRectRgba(m, 2, rect, { r: 255, g: 40, b: 70, a: 0.45 }, true);
    expect(px[3]).toBe(0);
    expect(px[7]).toBe(115); // round(255 * 0.45)
  });
});
