import { describe, expect, it } from "vitest";

import { applyMaskAlpha, saliencyToAlpha, toIsnetInput } from "../matte";

describe("toIsnetInput", () => {
  it("normaliza px/255 com mean 0.5 std 1.0, em CHW", () => {
    // 2×1: um pixel preto e um branco (alpha ignorado de propósito).
    const rgba = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 128]);
    const chw = toIsnetInput(rgba, 2, 1);
    expect(chw).toHaveLength(6);
    // Preto → -0.5 nos 3 canais; branco → +0.5.
    expect(chw[0]).toBeCloseTo(-0.5); // R do pixel 0
    expect(chw[1]).toBeCloseTo(0.5); // R do pixel 1
    expect(chw[2]).toBeCloseTo(-0.5); // G do pixel 0
    expect(chw[3]).toBeCloseTo(0.5); // G do pixel 1
    expect(chw[4]).toBeCloseTo(-0.5); // B do pixel 0
    expect(chw[5]).toBeCloseTo(0.5); // B do pixel 1
  });

  it("separa os canais de um pixel colorido", () => {
    const rgba = new Uint8ClampedArray([255, 0, 51, 255]);
    const chw = toIsnetInput(rgba, 1, 1);
    expect(chw[0]).toBeCloseTo(0.5);
    expect(chw[1]).toBeCloseTo(-0.5);
    expect(chw[2]).toBeCloseTo(51 / 255 - 0.5);
  });
});

describe("saliencyToAlpha", () => {
  it("re-escala por min-max pra 0–255 (como o rembg)", () => {
    const a = saliencyToAlpha(new Float32Array([-2, 0, 2]));
    expect(Array.from(a)).toEqual([0, 128, 255]);
  });

  it("mapa constante vira tudo 0 sem dividir por zero", () => {
    const a = saliencyToAlpha(new Float32Array([3, 3, 3]));
    expect(Array.from(a)).toEqual([0, 0, 0]);
  });
});

describe("applyMaskAlpha", () => {
  it("máscara 255 preserva, 0 apaga, intermediária escala", () => {
    const rgba = new Uint8ClampedArray([
      10, 20, 30, 255, // fica
      40, 50, 60, 255, // some
      70, 80, 90, 255, // metade
    ]);
    applyMaskAlpha(rgba, new Uint8ClampedArray([255, 0, 128]));
    expect(rgba[3]).toBe(255);
    expect(rgba[7]).toBe(0);
    expect(rgba[11]).toBe(128);
    // Cor não muda — só o alpha.
    expect(Array.from(rgba.slice(0, 3))).toEqual([10, 20, 30]);
  });

  it("MULTIPLICA pelo alpha existente (semitransparente não fica mais opaco)", () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 100]);
    applyMaskAlpha(rgba, new Uint8ClampedArray([255]));
    expect(rgba[3]).toBe(100); // máscara cheia mantém os 100
    const rgba2 = new Uint8ClampedArray([0, 0, 0, 100]);
    applyMaskAlpha(rgba2, new Uint8ClampedArray([128]));
    expect(rgba2[3]).toBe(Math.round((100 * 128) / 255));
  });
});
