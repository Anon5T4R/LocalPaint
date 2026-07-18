import { describe, expect, it } from "vitest";

import { applyAdjust, boxBlur, grayscale, invert, isNeutral, NEUTRAL_ADJUST, sharpen } from "../filters";

function px(r: number, g: number, b: number, a = 255): Uint8ClampedArray {
  return new Uint8ClampedArray([r, g, b, a]);
}

describe("applyAdjust", () => {
  it("ajuste neutro é no-op byte a byte", () => {
    const d = px(10, 200, 77, 128);
    applyAdjust(d, NEUTRAL_ADJUST);
    expect([...d]).toEqual([10, 200, 77, 128]);
    expect(isNeutral(NEUTRAL_ADJUST)).toBe(true);
  });

  it("brilho positivo clareia, negativo escurece, alpha intacto", () => {
    const claro = px(100, 100, 100, 200);
    applyAdjust(claro, { ...NEUTRAL_ADJUST, brightness: 50 });
    expect(claro[0]).toBeGreaterThan(100);
    expect(claro[3]).toBe(200);

    const escuro = px(100, 100, 100);
    applyAdjust(escuro, { ...NEUTRAL_ADJUST, brightness: -50 });
    expect(escuro[0]).toBeLessThan(100);
  });

  it("contraste afasta os extremos do meio e clampa", () => {
    const d = new Uint8ClampedArray([50, 50, 50, 255, 200, 200, 200, 255]);
    applyAdjust(d, { ...NEUTRAL_ADJUST, contrast: 60 });
    expect(d[0]).toBeLessThan(50); // escuro fica mais escuro
    expect(d[4]).toBeGreaterThan(200); // claro fica mais claro
  });

  it("saturação -100 vira cinza (canais iguais)", () => {
    const d = px(200, 40, 90);
    applyAdjust(d, { ...NEUTRAL_ADJUST, saturation: -100 });
    expect(d[0]).toBe(d[1]);
    expect(d[1]).toBe(d[2]);
  });

  it("matiz 180° leva vermelho pra perto de ciano e preserva neutro cinza", () => {
    const d = px(255, 0, 0);
    applyAdjust(d, { ...NEUTRAL_ADJUST, hue: 180 });
    // Vermelho girado 180° tem que ter mais G/B que R.
    expect(d[1]).toBeGreaterThan(d[0]);
    expect(d[2]).toBeGreaterThan(d[0]);

    const cinza = px(128, 128, 128);
    applyAdjust(cinza, { ...NEUTRAL_ADJUST, hue: 90 });
    // Cinza está NO eixo de rotação — não pode mudar (tolerância de arredondamento).
    expect(Math.abs(cinza[0] - 128)).toBeLessThanOrEqual(2);
    expect(Math.abs(cinza[1] - 128)).toBeLessThanOrEqual(2);
    expect(Math.abs(cinza[2] - 128)).toBeLessThanOrEqual(2);
  });
});

describe("grayscale / invert", () => {
  it("grayscale iguala canais pesando pela luma", () => {
    const d = px(255, 0, 0);
    grayscale(d);
    expect(d[0]).toBe(d[1]);
    expect(d[0]).toBe(54); // 0.2126·255 ≈ 54
  });

  it("invert é involução (aplicar duas vezes volta)", () => {
    const d = px(10, 200, 77, 128);
    invert(d);
    expect([...d.slice(0, 3)]).toEqual([245, 55, 178]);
    invert(d);
    expect([...d]).toEqual([10, 200, 77, 128]);
  });
});

describe("boxBlur", () => {
  it("raio 0 é no-op", () => {
    const d = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
    const antes = [...d];
    boxBlur(d, 2, 1, 0);
    expect([...d]).toEqual(antes);
  });

  it("espalha um ponto branco (o vizinho ganha luz, o centro perde)", () => {
    // 5x5 preto opaco com centro branco.
    const w = 5;
    const h = 5;
    const d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) d[i * 4 + 3] = 255;
    const c = (2 * w + 2) * 4;
    d[c] = 255;
    d[c + 1] = 255;
    d[c + 2] = 255;
    boxBlur(d, w, h, 1);
    const centro = d[c];
    const vizinho = d[(2 * w + 1) * 4];
    expect(centro).toBeLessThan(255);
    expect(vizinho).toBeGreaterThan(0);
  });

  it("área uniforme continua uniforme (conservação, sem vazamento de borda)", () => {
    const w = 4;
    const h = 4;
    const d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      d[i * 4] = 100;
      d[i * 4 + 1] = 150;
      d[i * 4 + 2] = 200;
      d[i * 4 + 3] = 255;
    }
    boxBlur(d, w, h, 2);
    for (let i = 0; i < w * h; i++) {
      expect(Math.abs(d[i * 4] - 100)).toBeLessThanOrEqual(1);
      expect(Math.abs(d[i * 4 + 1] - 150)).toBeLessThanOrEqual(1);
      expect(Math.abs(d[i * 4 + 2] - 200)).toBeLessThanOrEqual(1);
    }
  });

  it("transparente não sangra preto na cor (pré-multiplicação)", () => {
    // Metade esquerda: vermelho opaco. Direita: transparente (bytes zerados).
    const w = 6;
    const h = 1;
    const d = new Uint8ClampedArray(w * h * 4);
    for (let x = 0; x < 3; x++) {
      d[x * 4] = 255;
      d[x * 4 + 3] = 255;
    }
    boxBlur(d, w, h, 1);
    // No pixel da fronteira ainda-visível, a COR tem que seguir vermelha
    // (não um vinho escurecido pelo preto do lado transparente).
    expect(d[2 * 4]).toBeGreaterThan(200);
    expect(d[2 * 4 + 3]).toBeLessThan(255); // alpha borrado de verdade
  });
});

describe("sharpen", () => {
  it("amount 0 é no-op; amount > 0 aumenta contraste local", () => {
    const w = 5;
    const h = 1;
    const mk = () => {
      const d = new Uint8ClampedArray(w * h * 4);
      const vals = [100, 100, 180, 100, 100];
      vals.forEach((v, x) => {
        d[x * 4] = v;
        d[x * 4 + 1] = v;
        d[x * 4 + 2] = v;
        d[x * 4 + 3] = 255;
      });
      return d;
    };
    const zero = mk();
    sharpen(zero, w, h, 0);
    expect([...zero]).toEqual([...mk()]);

    const d = mk();
    sharpen(d, w, h, 1);
    expect(d[2 * 4]).toBeGreaterThan(180); // o pico fica mais alto
  });
});
