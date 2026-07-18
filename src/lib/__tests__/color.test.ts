import { describe, expect, it } from "vitest";

import { dist2, hexToRgba, rgbaToCss, rgbaToHex } from "../color";

describe("color", () => {
  it("hex ↔ rgba roundtrip", () => {
    expect(hexToRgba("#d97706")).toEqual({ r: 217, g: 119, b: 6, a: 255 });
    expect(rgbaToHex({ r: 217, g: 119, b: 6, a: 255 })).toBe("#d97706");
  });

  it("aceita hex com alpha e sem #", () => {
    expect(hexToRgba("ff000080")).toEqual({ r: 255, g: 0, b: 0, a: 128 });
  });

  it("hex inválido → null (não NaN silencioso)", () => {
    expect(hexToRgba("#zzz")).toBeNull();
    expect(hexToRgba("")).toBeNull();
    expect(hexToRgba("#1234")).toBeNull();
  });

  it("css: rgb quando opaco, rgba quando não", () => {
    expect(rgbaToCss({ r: 1, g: 2, b: 3, a: 255 })).toBe("rgb(1,2,3)");
    expect(rgbaToCss({ r: 1, g: 2, b: 3, a: 128 })).toBe("rgba(1,2,3,0.502)");
  });

  it("dist2 é zero pra cor igual e simétrica", () => {
    expect(dist2(10, 20, 30, 40, 10, 20, 30, 40)).toBe(0);
    expect(dist2(0, 0, 0, 0, 1, 2, 3, 4)).toBe(dist2(1, 2, 3, 4, 0, 0, 0, 0));
  });
});
