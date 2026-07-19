import { describe, expect, it } from "vitest";

import { CLEAR_AT, OPAQUE_AT, blurMask, decontaminateEdge, featherMask } from "../refine";

/** Máscara de um retângulo sólido centrado — a borda dura que o feather ataca. */
function blockMask(w: number, h: number, x0: number, y0: number, x1: number, y1: number): Uint8ClampedArray {
  const m = new Uint8ClampedArray(w * h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 255;
  return m;
}

describe("featherMask", () => {
  it("raio 0 devolve a máscara igual", () => {
    const m = blockMask(32, 32, 8, 8, 24, 24);
    const out = featherMask(m, 32, 32, 0);
    expect(Array.from(out)).toEqual(Array.from(m));
  });

  it("cria degraus intermediários na borda (o que a máscara dura não tinha)", () => {
    const m = blockMask(64, 64, 16, 16, 48, 48);
    const out = featherMask(m, 64, 64, 4);
    // Antes: só 0 e 255. Depois: valores no meio ao longo da transição.
    const mids = Array.from(out).filter((v) => v > CLEAR_AT && v < OPAQUE_AT).length;
    expect(mids).toBeGreaterThan(0);
    // A transição atravessa o meio da aresta de forma monótona.
    const row = 32 * 64;
    expect(out[row + 14]).toBeLessThan(out[row + 16]);
    expect(out[row + 16]).toBeLessThan(out[row + 18]);
  });

  it("NÃO toca o miolo sólido nem o fundo distante", () => {
    const m = blockMask(64, 64, 16, 16, 48, 48);
    const out = featherMask(m, 64, 64, 3);
    expect(out[32 * 64 + 32]).toBe(255); // centro do bloco
    expect(out[2 * 64 + 2]).toBe(0); // canto do fundo
  });

  it("máscara sem borda nenhuma (toda cheia) passa intacta", () => {
    const m = new Uint8ClampedArray(16 * 16).fill(255);
    const out = featherMask(m, 16, 16, 5);
    expect(Array.from(out).every((v) => v === 255)).toBe(true);
  });

  it("bate com o blur da máscara inteira dentro da faixa da borda", () => {
    // A restrição à faixa é economia, não mudança de resultado: onde o blur
    // importa, os dois têm que dar o mesmo valor.
    const m = blockMask(64, 64, 20, 20, 44, 44);
    const full = blurMask(m, 64, 64, 3);
    const band = featherMask(m, 64, 64, 3);
    const row = 32 * 64;
    for (let x = 16; x < 26; x++) expect(band[row + x]).toBe(full[row + x]);
  });
});

describe("decontaminateEdge — recuperação de F na mistura construída", () => {
  /** Constrói o caso que a matemática promete resolver: objeto de cor F sobre
   *  fundo de cor B, com uma RAMPA de alpha atravessando a borda. Cada pixel da
   *  rampa recebe literalmente `C = α·F + (1−α)·B` — a mesma conta que a
   *  câmera faz. Descontaminar tem que devolver F. */
  function buildMix(F: [number, number, number], B: [number, number, number], w = 40, h = 40) {
    const rgba = new Uint8ClampedArray(w * h * 4);
    const mask = new Uint8ClampedArray(w * h);
    const objX0 = 14;
    const objX1 = 26;
    const ramp = 4; // px de transição de cada lado
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        // alpha: 1 dentro, 0 fora, rampa linear nas duas laterais
        let a: number;
        if (x < objX0 - ramp || x >= objX1 + ramp) a = 0;
        else if (x >= objX0 && x < objX1) a = 1;
        else if (x < objX0) a = (x - (objX0 - ramp)) / ramp;
        else a = 1 - (x - (objX1 - 1)) / (ramp + 1);
        a = Math.min(1, Math.max(0, a));
        mask[p] = Math.round(a * 255);
        const i = p * 4;
        for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(a * F[c] + (1 - a) * B[c]);
        rgba[i + 3] = 255;
      }
    }
    return { rgba, mask, w, h, objX0, objX1, ramp };
  }

  /** Pior erro |RGB − F| sobre a FRANJA (os pixels que a descontaminação trata).
   *  O α=0 fica de fora de propósito: alpha zero é pixel invisível, não há F
   *  pra recuperar ali e reescrevê-lo seria inventar cor no vazio. */
  function worstFringeError(
    rgba: Uint8ClampedArray,
    mask: Uint8ClampedArray,
    F: [number, number, number],
  ): { err: number; n: number } {
    let err = 0;
    let n = 0;
    for (let p = 0; p < mask.length; p++) {
      if (mask[p] <= CLEAR_AT || mask[p] >= OPAQUE_AT) continue;
      const i = p * 4;
      for (let c = 0; c < 3; c++) err = Math.max(err, Math.abs(rgba[i + c] - F[c]));
      n++;
    }
    return { err, n };
  }

  it("recupera F com erro pequeno — gato branco sobre tapete claro", () => {
    // O caso real do relato: branco quase puro contaminado por um claro quente.
    const F: [number, number, number] = [250, 248, 245];
    const B: [number, number, number] = [205, 198, 186];
    const { rgba, mask, w, h } = buildMix(F, B);

    // ANTES: a franja carrega o tapete dentro dela.
    const before = worstFringeError(rgba, mask, F);
    expect(before.n).toBeGreaterThan(0);
    expect(before.err).toBeGreaterThan(30); // o halo existe e é grande

    decontaminateEdge(rgba, mask, w, h, 4);

    // DEPOIS: só o arredondamento pra byte deve sobrar.
    expect(worstFringeError(rgba, mask, F).err).toBeLessThanOrEqual(2);
  });

  it("recupera F num contraste extremo (preto sobre branco)", () => {
    const F: [number, number, number] = [10, 12, 8];
    const B: [number, number, number] = [245, 250, 255];
    const { rgba, mask, w, h } = buildMix(F, B);
    expect(worstFringeError(rgba, mask, F).err).toBeGreaterThan(150);
    decontaminateEdge(rgba, mask, w, h, 4);
    expect(worstFringeError(rgba, mask, F).err).toBeLessThanOrEqual(2);
  });

  it("não mexe no alpha — quem grava alpha é o applyMaskAlpha", () => {
    const { rgba, mask, w, h } = buildMix([255, 255, 255], [200, 190, 180]);
    const alphaBefore = Array.from(rgba).filter((_, i) => i % 4 === 3);
    decontaminateEdge(rgba, mask, w, h, 4);
    const alphaAfter = Array.from(rgba).filter((_, i) => i % 4 === 3);
    expect(alphaAfter).toEqual(alphaBefore);
  });

  it("não mexe no miolo opaco nem no fundo puro", () => {
    const { rgba, mask, w, h } = buildMix([250, 248, 245], [205, 198, 186]);
    const before = new Uint8ClampedArray(rgba);
    decontaminateEdge(rgba, mask, w, h, 4);
    const opaque = (20 * w + 20) * 4; // dentro do objeto
    const clear = (20 * w + 2) * 4; // fundo distante
    for (let c = 0; c < 3; c++) {
      expect(rgba[opaque + c]).toBe(before[opaque + c]);
      expect(rgba[clear + c]).toBe(before[clear + c]);
    }
  });

  it("devolve a contagem de pixels reescritos, e é só a franja", () => {
    const { rgba, mask, w, h } = buildMix([250, 248, 245], [205, 198, 186]);
    const touched = decontaminateEdge(rgba, mask, w, h, 4);
    let fringe = 0;
    for (let p = 0; p < mask.length; p++) if (mask[p] > CLEAR_AT && mask[p] < OPAQUE_AT) fringe++;
    expect(touched).toBe(fringe);
    expect(touched).toBeGreaterThan(0);
  });

  it("máscara sem franja (tudo 0/255) não reescreve nada", () => {
    const w = 16;
    const h = 16;
    const rgba = new Uint8ClampedArray(w * h * 4).fill(128);
    const mask = blockMask(w, h, 4, 4, 12, 12);
    const before = new Uint8ClampedArray(rgba);
    expect(decontaminateEdge(rgba, mask, w, h, 3)).toBe(0);
    expect(Array.from(rgba)).toEqual(Array.from(before));
  });

  it("franja sem nenhum vizinho opaco fica intocada (não inventa cor)", () => {
    // Máscara inteira em 128: não existe pixel opaco pra servir de F_est.
    const w = 24;
    const h = 24;
    const rgba = new Uint8ClampedArray(w * h * 4).fill(90);
    const mask = new Uint8ClampedArray(w * h).fill(128);
    const before = new Uint8ClampedArray(rgba);
    expect(decontaminateEdge(rgba, mask, w, h, 3)).toBe(0);
    expect(Array.from(rgba)).toEqual(Array.from(before));
  });

  it("feather + descontaminar compõem: a franja larga do feather é corrigida", () => {
    // O caso que o raio de busca em dois estágios existe pra cobrir.
    const F: [number, number, number] = [250, 248, 245];
    const B: [number, number, number] = [205, 198, 186];
    const w = 60;
    const h = 60;
    const rgba = new Uint8ClampedArray(w * h * 4);
    const hard = blockMask(w, h, 20, 20, 40, 40);
    const soft = featherMask(hard, w, h, 5);
    for (let p = 0; p < soft.length; p++) {
      const a = soft[p] / 255;
      const i = p * 4;
      for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(a * F[c] + (1 - a) * B[c]);
      rgba[i + 3] = 255;
    }
    // O raio precisa ATRAVESSAR a franja pra achar objeto puro de um lado e
    // fundo puro do outro; o feather de 5 espalha ~9 px pra cada lado (3
    // passadas de box), daí 12. É por isso que o estado soma o raio do feather
    // ao pedido pelo usuário antes de chamar aqui.
    const wide = new Uint8ClampedArray(rgba);
    const touched = decontaminateEdge(wide, soft, w, h, 12);
    expect(touched).toBeGreaterThan(0);
    // Na franja, o RGB tem que ter andado na direção de F (longe de B).
    expect(worstFringeError(wide, soft, F).err).toBeLessThanOrEqual(8);
  });

  it("raio curto demais pra franja: no-op seguro, nunca cor inventada", () => {
    // Contrato explícito do degrade. Um raio que não alcança objeto puro NEM
    // fundo puro deixa o pixel como estava — o defeito continua visível, que é
    // muito melhor que uma franja pintada com cor chutada.
    const F: [number, number, number] = [250, 248, 245];
    const B: [number, number, number] = [205, 198, 186];
    const w = 60;
    const h = 60;
    const rgba = new Uint8ClampedArray(w * h * 4);
    const soft = featherMask(blockMask(w, h, 20, 20, 40, 40), w, h, 5);
    for (let p = 0; p < soft.length; p++) {
      const a = soft[p] / 255;
      const i = p * 4;
      for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(a * F[c] + (1 - a) * B[c]);
      rgba[i + 3] = 255;
    }
    const before = new Uint8ClampedArray(rgba);
    decontaminateEdge(rgba, soft, w, h, 1);
    // O miolo da franja (longe dos dois extremos) tem que ter ficado idêntico.
    const mid = (30 * w + 30 - 10) * 4;
    for (let c = 0; c < 3; c++) expect(rgba[mid + c]).toBe(before[mid + c]);
  });
});
