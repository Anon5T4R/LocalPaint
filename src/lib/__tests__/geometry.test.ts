import { describe, expect, it } from "vitest";

import {
  bresenham,
  clampRect,
  constrainAngle,
  constrainSquare,
  normRect,
  strokeBbox,
  unionRect,
} from "../geometry";

describe("normRect", () => {
  it("normaliza cantos em qualquer ordem", () => {
    expect(normRect(10, 10, 4, 2)).toEqual({ x: 4, y: 2, w: 6, h: 8 });
  });
});

describe("clampRect", () => {
  it("recorta pro documento", () => {
    expect(clampRect({ x: -5, y: -5, w: 20, h: 20 }, 10, 10)).toEqual({ x: 0, y: 0, w: 10, h: 10 });
  });
  it("inteiro fora → null", () => {
    expect(clampRect({ x: 50, y: 0, w: 5, h: 5 }, 10, 10)).toBeNull();
    expect(clampRect({ x: -20, y: 0, w: 5, h: 5 }, 10, 10)).toBeNull();
  });
  it("arredonda pra FORA (ceil) — dirty-rect nunca perde meio pixel", () => {
    expect(clampRect({ x: 1.2, y: 1.7, w: 2.1, h: 1.1 }, 10, 10)).toEqual({ x: 1, y: 1, w: 3, h: 2 });
  });
});

describe("unionRect", () => {
  it("une dois retângulos", () => {
    expect(unionRect({ x: 0, y: 0, w: 2, h: 2 }, { x: 5, y: 5, w: 1, h: 1 })).toEqual({
      x: 0,
      y: 0,
      w: 6,
      h: 6,
    });
  });
  it("null é identidade", () => {
    const r = { x: 1, y: 1, w: 2, h: 2 };
    expect(unionRect(null, r)).toEqual(r);
    expect(unionRect(r, null)).toEqual(r);
  });
});

describe("strokeBbox", () => {
  it("engorda pelo raio +1 de folga de anti-alias", () => {
    const r = strokeBbox([{ x: 10, y: 10 }, { x: 20, y: 12 }], 4);
    expect(r).toEqual({ x: 5, y: 5, w: 20, h: 12 });
  });
  it("sem pontos → null", () => {
    expect(strokeBbox([], 4)).toBeNull();
  });
});

describe("bresenham", () => {
  it("horizontal e diagonal incluem as pontas", () => {
    expect(bresenham(0, 0, 3, 0)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
    const diag = bresenham(0, 0, 2, 2);
    expect(diag[0]).toEqual({ x: 0, y: 0 });
    expect(diag[diag.length - 1]).toEqual({ x: 2, y: 2 });
  });
  it("linha íngreme não pula pixel (contiguidade-8)", () => {
    const pts = bresenham(0, 0, 2, 7);
    for (let i = 1; i < pts.length; i++) {
      expect(Math.abs(pts[i].x - pts[i - 1].x)).toBeLessThanOrEqual(1);
      expect(Math.abs(pts[i].y - pts[i - 1].y)).toBeLessThanOrEqual(1);
    }
    expect(pts[pts.length - 1]).toEqual({ x: 2, y: 7 });
  });
});

describe("constrains (Shift)", () => {
  it("quadrado usa o menor delta e preserva direção", () => {
    expect(constrainSquare(0, 0, 10, -4)).toEqual({ x1: 4, y1: -4 });
  });
  it("linha tranca em 45°", () => {
    const { x1, y1 } = constrainAngle(0, 0, 10, 9);
    expect(x1).toBeCloseTo(y1, 5); // 45° exato
  });
  it("linha tranca em 0° (horizontal quase-reta)", () => {
    const { y1 } = constrainAngle(0, 0, 10, 1);
    expect(y1).toBeCloseTo(0, 5);
  });
});
