import { describe, expect, it } from "vitest";

import { floodFill } from "../fill";
import type { Rgba } from "../color";

/** Monta um bitmap RGBA a partir de linhas de chars: '.'=transparente, letras
 *  viram cores fixas. Legível no teste — a grade É o caso. */
const COLORS: Record<string, Rgba> = {
  ".": { r: 0, g: 0, b: 0, a: 0 },
  "#": { r: 0, g: 0, b: 0, a: 255 },
  r: { r: 255, g: 0, b: 0, a: 255 },
  g: { r: 0, g: 255, b: 0, a: 255 },
  n: { r: 250, g: 5, b: 5, a: 255 }, // "quase vermelho" pra teste de tolerância
};

function grid(rows: string[]): { data: Uint8ClampedArray; w: number; h: number } {
  const h = rows.length;
  const w = rows[0].length;
  const data = new Uint8ClampedArray(w * h * 4);
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const c = COLORS[ch];
      const i = (y * w + x) * 4;
      data[i] = c.r;
      data[i + 1] = c.g;
      data[i + 2] = c.b;
      data[i + 3] = c.a;
    });
  });
  return { data, w, h };
}

function at(data: Uint8ClampedArray, w: number, x: number, y: number): Rgba {
  const i = (y * w + x) * 4;
  return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
}

const GREEN = COLORS.g;

describe("floodFill", () => {
  it("preenche região contígua e respeita a parede", () => {
    const { data, w, h } = grid([
      "....#....",
      "....#....",
      "....#....",
    ]);
    const rect = floodFill(data, w, h, 1, 1, GREEN);
    expect(rect).toEqual({ x: 0, y: 0, w: 4, h: 3 });
    expect(at(data, w, 0, 0)).toEqual(GREEN);
    expect(at(data, w, 3, 2)).toEqual(GREEN);
    // A parede e o outro lado ficam intactos.
    expect(at(data, w, 4, 1).a).toBe(255);
    expect(at(data, w, 5, 1).a).toBe(0);
  });

  it("vaza por corredor (conectividade-4 de verdade)", () => {
    const { data, w, h } = grid([
      "##.##",
      "#...#",
      "##.##",
    ]);
    floodFill(data, w, h, 2, 0, GREEN);
    // Desce pelo corredor do meio e abre nos dois braços.
    expect(at(data, w, 2, 2)).toEqual(GREEN);
    expect(at(data, w, 1, 1)).toEqual(GREEN);
    expect(at(data, w, 3, 1)).toEqual(GREEN);
    expect(at(data, w, 0, 0).a).toBe(255); // parede intacta
  });

  it("diagonal NÃO conecta (balde não atravessa quina)", () => {
    const { data, w, h } = grid([
      "#.",
      ".#",
    ]);
    floodFill(data, w, h, 1, 0, GREEN);
    expect(at(data, w, 1, 0)).toEqual(GREEN);
    // O outro '.' é vizinho só na diagonal — fica como está.
    expect(at(data, w, 0, 1).a).toBe(0);
  });

  it("tolerância pega cor vizinha; sem tolerância não pega", () => {
    const base = ["rn", "nr"];
    const strict = grid(base);
    floodFill(strict.data, strict.w, strict.h, 0, 0, GREEN, 0);
    expect(at(strict.data, strict.w, 0, 0)).toEqual(GREEN);
    expect(at(strict.data, strict.w, 1, 0)).toEqual(COLORS.n); // 'n' escapa

    const loose = grid(base);
    floodFill(loose.data, loose.w, loose.h, 0, 0, GREEN, 12);
    // Com tolerância, o quase-vermelho entra e conecta tudo.
    expect(at(loose.data, loose.w, 1, 0)).toEqual(GREEN);
    expect(at(loose.data, loose.w, 1, 1)).toEqual(GREEN);
  });

  it("clique fora do doc → null e nada muda", () => {
    const { data, w, h } = grid(["..", ".."]);
    const before = [...data];
    expect(floodFill(data, w, h, -1, 0, GREEN)).toBeNull();
    expect(floodFill(data, w, h, 0, 5, GREEN)).toBeNull();
    expect([...data]).toEqual(before);
  });

  it("cor alvo já é a pedida → null (no-op não suja o undo)", () => {
    const { data, w, h } = grid(["gg", "gg"]);
    expect(floodFill(data, w, h, 0, 0, GREEN)).toBeNull();
  });

  it("cor de preenchimento DENTRO da tolerância do alvo não trava (visited)", () => {
    // Alvo 'r' (255,0,0), preenchendo com 'n' (250,5,5), tolerância alta: o
    // pixel pintado ainda "casa" com o alvo — sem visited, loop infinito.
    const { data, w, h } = grid(["rrr", "rrr"]);
    const rect = floodFill(data, w, h, 1, 1, COLORS.n, 50);
    expect(rect).toEqual({ x: 0, y: 0, w: 3, h: 2 });
    expect(at(data, w, 0, 0)).toEqual(COLORS.n);
  });

  it("dirty-rect é exato (não devolve o doc inteiro)", () => {
    const { data, w, h } = grid([
      ".....",
      ".###.",
      ".#g#.",
      ".###.",
      ".....",
    ]);
    // Preenche só o miolo 'g' (1 pixel).
    const rect = floodFill(data, w, h, 2, 2, COLORS.r);
    expect(rect).toEqual({ x: 2, y: 2, w: 1, h: 1 });
  });
});
