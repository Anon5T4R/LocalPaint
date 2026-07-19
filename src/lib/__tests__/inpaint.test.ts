import { describe, expect, it } from "vitest";

import type { Rect } from "../geometry";
import {
  blendHole,
  cropMask,
  fromLamaOutput,
  INPAINT_DIM,
  planInpaint,
  resample,
  resampleMaskMax,
  toLamaImage,
  toLamaMask,
} from "../inpaint";
import type { MaskSel } from "../mask";

const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h;

const inDoc = (r: Rect, w: number, h: number) => r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h;

describe("planInpaint", () => {
  it("cresce a janela até 512 quando a seleção é pequena (contexto de graça)", () => {
    // Abaixo de 512 não há redução nenhuma — contexto extra não custa nitidez.
    const crop = planInpaint({ x: 500, y: 500, w: 40, h: 40 }, 2000, 2000);
    expect(crop.w).toBe(INPAINT_DIM);
    expect(crop.h).toBe(INPAINT_DIM);
    // Centrada na seleção.
    expect(crop.x + crop.w / 2).toBeCloseTo(520, 0);
    expect(crop.y + crop.h / 2).toBeCloseTo(520, 0);
  });

  it("passa de 512 com margem de contexto quando a seleção é grande", () => {
    const crop = planInpaint({ x: 100, y: 100, w: 600, h: 400 }, 4000, 4000);
    // 600 * 1,8 = 1080 — a margem é o que dá contexto ao modelo.
    expect(crop.w).toBe(1080);
    expect(crop.h).toBe(1080);
  });

  it("nunca sai do documento e nunca corta a seleção", () => {
    const docs: [number, number][] = [
      [2000, 2000],
      [640, 480],
      [300, 300], // documento menor que a entrada do modelo
      [4000, 200], // documento achatado: a janela degenera pra retangular
      [200, 4000],
    ];
    const sels: Rect[] = [
      { x: 0, y: 0, w: 10, h: 10 }, // canto superior esquerdo
      { x: 5, y: 5, w: 50, h: 900 }, // seleção mais alta que doc achatado
      { x: 100, y: 20, w: 800, h: 30 },
    ];
    for (const [dw, dh] of docs) {
      for (const s of sels) {
        // Só casos em que a seleção cabe no doc (invariante de quem chama).
        const sel = { x: s.x, y: s.y, w: Math.min(s.w, dw - s.x), h: Math.min(s.h, dh - s.y) };
        if (sel.w <= 0 || sel.h <= 0) continue;
        const crop = planInpaint(sel, dw, dh);
        expect(inDoc(crop, dw, dh), `janela fora do doc ${dw}x${dh} sel ${JSON.stringify(sel)}`).toBe(true);
        expect(contains(crop, sel), `janela cortou a seleção ${JSON.stringify(sel)} em ${dw}x${dh}`).toBe(true);
      }
    }
  });

  it("encosta a janela na borda em vez de centrar fora do doc", () => {
    const crop = planInpaint({ x: 0, y: 0, w: 20, h: 20 }, 2000, 2000);
    expect(crop.x).toBe(0);
    expect(crop.y).toBe(0);
  });
});

describe("cropMask", () => {
  it("posiciona a máscara da seleção dentro da janela", () => {
    const sel: MaskSel = {
      bounds: { x: 10, y: 10, w: 2, h: 2 },
      mask: new Uint8Array([1, 0, 0, 1]),
    };
    const crop: Rect = { x: 9, y: 9, w: 4, h: 4 };
    const m = cropMask(sel, crop);
    // A diagonal da seleção cai em (1,1) e (2,2) da janela.
    expect(m[1 * 4 + 1]).toBe(1);
    expect(m[2 * 4 + 2]).toBe(1);
    expect(m[1 * 4 + 2]).toBe(0);
    expect([...m].reduce((a, b) => a + b, 0)).toBe(2);
  });

  it("trata mask null como retângulo cheio", () => {
    const sel: MaskSel = { bounds: { x: 1, y: 1, w: 2, h: 2 }, mask: null };
    const m = cropMask(sel, { x: 0, y: 0, w: 4, h: 4 });
    expect([...m].reduce((a, b) => a + b, 0)).toBe(4);
    expect(m[1 * 4 + 1]).toBe(1);
    expect(m[0]).toBe(0);
  });

  it("recorta a parte da seleção que cai fora da janela", () => {
    const sel: MaskSel = { bounds: { x: 0, y: 0, w: 10, h: 10 }, mask: null };
    const m = cropMask(sel, { x: 5, y: 5, w: 10, h: 10 });
    // Só o quadrante 5..9 da seleção sobrevive: 5×5.
    expect([...m].reduce((a, b) => a + b, 0)).toBe(25);
  });
});

describe("resample", () => {
  it("mesmo tamanho devolve cópia idêntica (sem interpolar à toa)", () => {
    const src = new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]);
    const out = resample(src, 2, 1, 2, 1);
    expect([...out]).toEqual([...src]);
    expect(out).not.toBe(src);
  });

  it("cor sólida sobrevive exata à redução e à ampliação", () => {
    // Se a média de área tiver viés de borda, a cor sólida denuncia.
    const w = 40;
    const h = 40;
    const src = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      src[i * 4] = 200;
      src[i * 4 + 1] = 100;
      src[i * 4 + 2] = 50;
      src[i * 4 + 3] = 255;
    }
    for (const [dw, dh] of [
      [7, 7],
      [13, 40],
      [97, 97],
    ] as [number, number][]) {
      const out = resample(src, w, h, dw, dh);
      expect(out.length).toBe(dw * dh * 4);
      for (let i = 0; i < dw * dh; i++) {
        expect([out[i * 4], out[i * 4 + 1], out[i * 4 + 2], out[i * 4 + 3]]).toEqual([200, 100, 50, 255]);
      }
    }
  });

  it("reduzir e voltar preserva o tamanho e a posição do conteúdo", () => {
    // Um quadrado claro no quadrante superior esquerdo tem que voltar no
    // quadrante superior esquerdo — meio pixel de deslocamento aqui viraria
    // colagem desalinhada no app.
    const w = 64;
    const src = new Uint8ClampedArray(w * w * 4);
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const v = x < 16 && y < 16 ? 255 : 0;
        const i = (y * w + x) * 4;
        src[i] = src[i + 1] = src[i + 2] = v;
        src[i + 3] = 255;
      }
    }
    const small = resample(src, w, w, 16, 16);
    const back = resample(small, 16, 16, w, w);
    const at = (x: number, y: number) => back[(y * w + x) * 4];
    expect(at(4, 4)).toBeGreaterThan(200);
    expect(at(60, 60)).toBeLessThan(40);
    expect(at(4, 60)).toBeLessThan(40);
  });
});

describe("resampleMaskMax", () => {
  it("um pixel solto de buraco sobrevive à redução", () => {
    // Média perderia esse pixel — e o objeto removido voltaria como pontinho.
    const sw = 64;
    const mask = new Uint8Array(sw * sw);
    mask[30 * sw + 30] = 1;
    const small = resampleMaskMax(mask, sw, sw, 8, 8);
    expect([...small].reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(1);
  });

  it("máscara vazia continua vazia e cheia continua cheia", () => {
    const vazia = resampleMaskMax(new Uint8Array(16 * 16), 16, 16, 4, 4);
    expect([...vazia].every((v) => v === 0)).toBe(true);
    const cheia = resampleMaskMax(new Uint8Array(16 * 16).fill(1), 16, 16, 4, 4);
    expect([...cheia].every((v) => v === 1)).toBe(true);
  });
});

describe("tensores do LaMa", () => {
  it("toLamaImage normaliza por 255 e sai em CHW", () => {
    // A escala foi medida: em 0–255 o modelo devolve lixo.
    const rgba = new Uint8ClampedArray([255, 0, 51, 255, 0, 102, 204, 255]);
    const t = toLamaImage(rgba, 2, 1);
    expect(t.length).toBe(6);
    expect(t[0]).toBeCloseTo(1); // R do pixel 0
    expect(t[1]).toBeCloseTo(0); // R do pixel 1
    expect(t[2]).toBeCloseTo(0); // G do pixel 0
    expect(t[3]).toBeCloseTo(0.4); // G do pixel 1
    expect(t[4]).toBeCloseTo(0.2); // B do pixel 0
    expect(t[5]).toBeCloseTo(0.8); // B do pixel 1
  });

  it("toLamaMask escreve 1 = BURACO (oposto do MI-GAN)", () => {
    // Inverter aqui não dá erro — dá resultado surreal (§4.6b).
    const t = toLamaMask(new Uint8Array([0, 1, 1, 0]));
    expect([...t]).toEqual([0, 1, 1, 0]);
  });

  it("fromLamaOutput volta de CHW 0–255 pra RGBA opaco", () => {
    const out = new Float32Array([10, 20, 30, 40, 50, 60]);
    const rgba = fromLamaOutput(out, 2, 1);
    expect([...rgba]).toEqual([10, 30, 50, 255, 20, 40, 60, 255]);
  });
});

describe("blendHole", () => {
  it("muda só o buraco e devolve o entorno byte a byte igual", () => {
    // O requisito mais importante da colagem: sujar o entorno com o ruído do
    // vai-e-volta de escala seria dano gratuito.
    const base = new Uint8ClampedArray([1, 2, 3, 4, 9, 9, 9, 9, 5, 6, 7, 8]);
    const antes = new Uint8ClampedArray(base);
    const filled = new Uint8ClampedArray([99, 99, 99, 99, 40, 50, 60, 70, 99, 99, 99, 99]);
    blendHole(base, filled, new Uint8Array([0, 1, 0]));
    expect([...base.slice(0, 4)]).toEqual([...antes.slice(0, 4)]);
    expect([...base.slice(8, 12)]).toEqual([...antes.slice(8, 12)]);
    // No buraco entra o preenchimento, com alpha opaco.
    expect([...base.slice(4, 8)]).toEqual([40, 50, 60, 255]);
  });

  it("máscara vazia não toca nada", () => {
    const base = new Uint8ClampedArray([1, 2, 3, 4]);
    blendHole(base, new Uint8ClampedArray([9, 9, 9, 9]), new Uint8Array([0]));
    expect([...base]).toEqual([1, 2, 3, 4]);
  });
});

describe("pipeline de geometria (recorte → 512 → volta → colagem)", () => {
  it("o entorno da janela volta intacto mesmo com o vai-e-volta de escala", () => {
    // Encanamento ponta a ponta sem o modelo: o que garante o "não sujou o
    // entorno" é a colagem pela máscara NATIVA, não a fidelidade do resample.
    const docW = 1500;
    const docH = 1200;
    const sel: MaskSel = { bounds: { x: 700, y: 600, w: 120, h: 90 }, mask: null };
    const crop = planInpaint(sel.bounds, docW, docH);
    expect(contains(crop, sel.bounds)).toBe(true);

    const px = new Uint8ClampedArray(crop.w * crop.h * 4);
    for (let i = 0; i < crop.w * crop.h; i++) {
      px[i * 4] = i % 251;
      px[i * 4 + 1] = (i * 7) % 253;
      px[i * 4 + 2] = (i * 13) % 249;
      px[i * 4 + 3] = 255;
    }
    const antes = new Uint8ClampedArray(px);
    const m = cropMask(sel, crop);

    const small = resample(px, crop.w, crop.h, INPAINT_DIM, INPAINT_DIM);
    expect(small.length).toBe(INPAINT_DIM * INPAINT_DIM * 4);
    const mSmall = resampleMaskMax(m, crop.w, crop.h, INPAINT_DIM, INPAINT_DIM);
    expect(toLamaImage(small, INPAINT_DIM, INPAINT_DIM).length).toBe(3 * INPAINT_DIM * INPAINT_DIM);
    expect(toLamaMask(mSmall).length).toBe(INPAINT_DIM * INPAINT_DIM);

    // Faz de conta que o modelo devolveu cinza chapado.
    const fake = new Float32Array(3 * INPAINT_DIM * INPAINT_DIM).fill(128);
    const filled512 = fromLamaOutput(fake, INPAINT_DIM, INPAINT_DIM);
    const filled = resample(filled512, INPAINT_DIM, INPAINT_DIM, crop.w, crop.h);
    blendHole(px, filled, m);

    let mudados = 0;
    let foraMudados = 0;
    for (let p = 0; p < crop.w * crop.h; p++) {
      const dif =
        px[p * 4] !== antes[p * 4] ||
        px[p * 4 + 1] !== antes[p * 4 + 1] ||
        px[p * 4 + 2] !== antes[p * 4 + 2] ||
        px[p * 4 + 3] !== antes[p * 4 + 3];
      if (dif) {
        mudados++;
        if (!m[p]) foraMudados++;
      }
    }
    expect(foraMudados).toBe(0);
    expect(mudados).toBe(120 * 90); // exatamente a seleção, nem 1 px a mais
  });
});
