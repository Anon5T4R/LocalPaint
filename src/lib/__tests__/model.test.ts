import { describe, expect, it } from "vitest";

import { blendToComposite, bumpIdsPast, clampDim, newLayerId, nextLayerName } from "../model";

describe("model", () => {
  it("clampDim segura os limites e lixo", () => {
    expect(clampDim(0)).toBe(1);
    expect(clampDim(99999)).toBe(8192);
    expect(clampDim(NaN)).toBe(1);
    expect(clampDim(1280.7)).toBe(1281);
  });

  it("blend normal vira source-over; os outros passam direto", () => {
    expect(blendToComposite("normal")).toBe("source-over");
    expect(blendToComposite("multiply")).toBe("multiply");
    expect(blendToComposite("soft-light")).toBe("soft-light");
  });

  it("nextLayerName acha o menor N livre (buraco no meio conta)", () => {
    expect(nextLayerName([], "Camada")).toBe("Camada 1");
    expect(nextLayerName(["Camada 1", "Camada 3"], "Camada")).toBe("Camada 2");
  });

  it("bumpIdsPast evita colisão com ids de arquivo aberto", () => {
    bumpIdsPast(["L900", "não-numérico", "L950"]);
    const id = newLayerId();
    expect(Number(id.slice(1))).toBeGreaterThan(950);
  });
});
