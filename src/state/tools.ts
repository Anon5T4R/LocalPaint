/** Store das ferramentas: qual está ativa e os parâmetros dela. */

import { create } from "zustand";

import type { Rgba } from "../lib/color";

export type Tool =
  | "select"
  | "wand"
  | "text"
  | "pencil"
  | "brush"
  | "eraser"
  | "fill"
  | "eyedropper"
  | "line"
  | "rect"
  | "ellipse";

export type ShapeMode = "stroke" | "fill" | "both";

interface ToolsState {
  tool: Tool;
  /** Diâmetro do pincel/borracha em px do DOCUMENTO (zoom não muda o traço). */
  size: number;
  /** Tolerância do balde, 0..255. */
  tolerance: number;
  shapeMode: ShapeMode;
  primary: Rgba;
  secondary: Rgba;
  recent: Rgba[];
  /** Clique da ferramenta de texto (coordenada de doc) — abre o TextModal. */
  textAt: { x: number; y: number } | null;
  setTextAt: (p: { x: number; y: number } | null) => void;

  setTool: (t: Tool) => void;
  setSize: (n: number) => void;
  setTolerance: (n: number) => void;
  setShapeMode: (m: ShapeMode) => void;
  setPrimary: (c: Rgba) => void;
  setSecondary: (c: Rgba) => void;
  swapColors: () => void;
  /** Cor usada de fato num gesto → entra nas recentes (sem duplicar). */
  noteUsed: (c: Rgba) => void;
}

const sameColor = (a: Rgba, b: Rgba) => a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

export const useTools = create<ToolsState>((set) => ({
  tool: "brush",
  size: 12,
  tolerance: 24,
  shapeMode: "stroke",
  primary: { r: 34, g: 34, b: 34, a: 255 },
  secondary: { r: 255, g: 255, b: 255, a: 255 },
  recent: [],
  textAt: null,
  setTextAt: (textAt) => set({ textAt }),

  setTool: (tool) => set({ tool }),
  setSize: (n) => set({ size: Math.min(200, Math.max(1, Math.round(n))) }),
  setTolerance: (n) => set({ tolerance: Math.min(255, Math.max(0, Math.round(n))) }),
  setShapeMode: (shapeMode) => set({ shapeMode }),
  setPrimary: (primary) => set({ primary }),
  setSecondary: (secondary) => set({ secondary }),
  swapColors: () => set((s) => ({ primary: s.secondary, secondary: s.primary })),
  noteUsed: (c) =>
    set((s) => {
      const rest = s.recent.filter((r) => !sameColor(r, c));
      return { recent: [c, ...rest].slice(0, 12) };
    }),
}));
