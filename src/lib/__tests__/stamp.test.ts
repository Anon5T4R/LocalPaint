import { describe, expect, it } from "vitest";

import { resolveStampTarget } from "../stamp";

const layerIds = ["a", "b", "c"];

describe("resolveStampTarget", () => {
  it("sem alvo explícito, o carimbo vai pra camada ATIVA (a regra nova)", () => {
    expect(resolveStampTarget({ activeId: "b", floatingLayerId: "a", layerIds })).toBe("b");
  });

  it("ativa == origem (o caso comum) continua indo pra origem — compat", () => {
    expect(resolveStampTarget({ activeId: "a", floatingLayerId: "a", layerIds })).toBe("a");
  });

  it("alvo explícito vivo vence a ativa E a origem", () => {
    expect(
      resolveStampTarget({ explicit: "c", activeId: "b", floatingLayerId: "a", layerIds }),
    ).toBe("c");
  });

  it("alvo explícito morto é pulado — cai pra ativa", () => {
    expect(
      resolveStampTarget({ explicit: "morta", activeId: "b", floatingLayerId: "a", layerIds }),
    ).toBe("b");
  });

  it("ativa morta cai pra origem (o fallback antigo, agora em 3º)", () => {
    expect(
      resolveStampTarget({ activeId: "morta", floatingLayerId: "a", layerIds }),
    ).toBe("a");
  });

  it("ativa nula cai pra origem", () => {
    expect(resolveStampTarget({ activeId: null, floatingLayerId: "c", layerIds })).toBe("c");
  });

  it("tudo morto/nulo = null (não há onde carimbar)", () => {
    expect(
      resolveStampTarget({ explicit: "x", activeId: "y", floatingLayerId: "z", layerIds }),
    ).toBeNull();
    expect(resolveStampTarget({ activeId: null, floatingLayerId: null, layerIds: [] })).toBeNull();
  });
});
