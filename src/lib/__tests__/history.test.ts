import { describe, expect, it } from "vitest";

import { canRedo, canUndo, newHistory, push, redo, undo, type HistoryEntry } from "../history";

/** Entrada fake que registra o que foi chamado — o teste vê a ORDEM real. */
function entry(log: string[], name: string, bytes = 0): HistoryEntry {
  return {
    label: name,
    bytes,
    undo: () => log.push(`undo:${name}`),
    redo: () => log.push(`redo:${name}`),
  };
}

describe("history", () => {
  it("undo desfaz na ordem inversa; redo repete na ordem original", () => {
    const log: string[] = [];
    let h = newHistory();
    h = push(h, entry(log, "a"));
    h = push(h, entry(log, "b"));

    h = undo(h);
    h = undo(h);
    expect(log).toEqual(["undo:b", "undo:a"]);

    h = redo(h);
    h = redo(h);
    expect(log).toEqual(["undo:b", "undo:a", "redo:a", "redo:b"]);
    expect(canRedo(h)).toBe(false);
    expect(canUndo(h)).toBe(true);
  });

  it("agir depois de undo mata o futuro (redo some)", () => {
    const log: string[] = [];
    let h = newHistory();
    h = push(h, entry(log, "a"));
    h = undo(h);
    expect(canRedo(h)).toBe(true);
    h = push(h, entry(log, "c"));
    expect(canRedo(h)).toBe(false);
  });

  it("orçamento expulsa as entradas MAIS ANTIGAS", () => {
    const log: string[] = [];
    let h = newHistory(100);
    h = push(h, entry(log, "velha", 60));
    h = push(h, entry(log, "meio", 30));
    h = push(h, entry(log, "nova", 30)); // 120 > 100 → "velha" cai
    expect(h.past.map((e) => e.label)).toEqual(["meio", "nova"]);
    expect(h.bytes).toBe(60);
  });

  it("entrada maior que o orçamento inteiro ainda entra (sozinha)", () => {
    const log: string[] = [];
    let h = newHistory(10);
    h = push(h, entry(log, "gigante", 500));
    expect(h.past.map((e) => e.label)).toEqual(["gigante"]);
    expect(canUndo(h)).toBe(true);
  });

  it("undo/redo em histórico vazio é no-op seguro", () => {
    let h = newHistory();
    h = undo(h);
    h = redo(h);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it("redo devolve os bytes ao total (contabilidade não vaza)", () => {
    const log: string[] = [];
    let h = newHistory(1000);
    h = push(h, entry(log, "a", 100));
    expect(h.bytes).toBe(100);
    h = undo(h);
    expect(h.bytes).toBe(0);
    h = redo(h);
    expect(h.bytes).toBe(100);
  });
});
