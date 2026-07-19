/** Seleção retangular — o estado e as operações que dependem dela.
 *
 *  O RECORTE FLUTUANTE (pixels levantados da camada durante um arrasto) mora
 *  num canvas de módulo, fora do zustand, pela mesma razão das camadas: canvas
 *  não é estado imutável. O store guarda só o retângulo e a posição.
 *
 *  Modelo de commit (o mesmo dos editores raster): mover pela primeira vez
 *  CORTA os pixels da camada (undo próprio); soltar em outro lugar ainda é
 *  flutuante; desselecionar/trocar de ferramenta CARIMBA na camada (undo
 *  próprio). Undo no meio devolve cada passo na ordem.
 */

import { create } from "zustand";

import { clampRect, type Rect } from "../lib/geometry";
import { layerCtx, requestRender } from "../lib/layers";
import { useDoc } from "./doc";

let floatingCanvas: HTMLCanvasElement | null = null;

export function getFloatingCanvas(): HTMLCanvasElement | null {
  return floatingCanvas;
}

interface SelectionState {
  /** Retângulo da seleção em coordenadas de DOC (null = sem seleção). */
  rect: Rect | null;
  /** true = os pixels da seleção estão levantados (no canvas flutuante). */
  floating: boolean;
  /** De qual camada os pixels foram levantados (o carimbo volta NELA). */
  floatingLayerId: string | null;

  select: (r: Rect | null) => void;
  selectAll: () => void;
  /** Levanta os pixels da camada ativa pro flutuante (início do arrasto). */
  lift: () => void;
  moveBy: (dx: number, dy: number) => void;
  /** Carimba o flutuante na camada e limpa a seleção. */
  commit: () => void;
  /** Sem seleção não há o que fazer; com flutuante, carimba antes de limpar. */
  deselect: () => void;
  /** Apaga o conteúdo da seleção na camada ativa (Delete). */
  deleteContents: () => void;
}

export const useSelection = create<SelectionState>((set, get) => ({
  rect: null,
  floating: false,
  floatingLayerId: null,

  select: (r) => {
    // Selecionar de novo com um flutuante pendurado primeiro assenta ele.
    if (get().floating) get().commit();
    const doc = useDoc.getState();
    const clamped = r ? clampRect(r, doc.width, doc.height) : null;
    set({ rect: clamped && clamped.w > 0 && clamped.h > 0 ? clamped : null });
    requestRender();
  },

  selectAll: () => {
    if (get().floating) get().commit();
    const doc = useDoc.getState();
    if (!doc.open) return;
    set({ rect: { x: 0, y: 0, w: doc.width, h: doc.height } });
    requestRender();
  },

  lift: () => {
    const { rect, floating } = get();
    const doc = useDoc.getState();
    if (!rect || floating || !doc.activeId) return;
    const layerId = doc.activeId;
    const ctx = layerCtx(layerId);

    const before = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);

    floatingCanvas = document.createElement("canvas");
    floatingCanvas.width = rect.w;
    floatingCanvas.height = rect.h;
    floatingCanvas.getContext("2d")!.putImageData(before, 0, 0);
    ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
    const after = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);

    const r0 = { ...rect };
    doc.pushHistory({
      label: "liftSelection",
      bytes: before.data.byteLength * 2,
      // Undo do corte: devolve os pixels E desfaz o estado flutuante — sem
      // isso, o usuário desfaz e fica um fantasma pendurado no mouse.
      undo: () => {
        layerCtx(layerId).putImageData(before, r0.x, r0.y);
        floatingCanvas = null;
        useSelection.setState({ rect: r0, floating: false, floatingLayerId: null });
      },
      redo: () => {
        layerCtx(layerId).clearRect(r0.x, r0.y, r0.w, r0.h);
        floatingCanvas = document.createElement("canvas");
        floatingCanvas.width = r0.w;
        floatingCanvas.height = r0.h;
        floatingCanvas.getContext("2d")!.putImageData(before, 0, 0);
        useSelection.setState({ rect: r0, floating: true, floatingLayerId: layerId });
      },
    });

    set({ floating: true, floatingLayerId: layerId });
    void after;
    requestRender();
  },

  moveBy: (dx, dy) => {
    const { rect } = get();
    if (!rect) return;
    set({ rect: { ...rect, x: rect.x + dx, y: rect.y + dy } });
    requestRender();
  },

  commit: () => {
    const { rect, floating, floatingLayerId } = get();
    if (!rect || !floating || !floatingLayerId || !floatingCanvas) {
      set({ rect: null, floating: false, floatingLayerId: null });
      requestRender();
      return;
    }
    const doc = useDoc.getState();
    // A camada pode ter sido removida enquanto o flutuante existia.
    const layerId = doc.layers.some((l) => l.id === floatingLayerId)
      ? floatingLayerId
      : doc.activeId;
    if (!layerId) return;

    const ctx = layerCtx(layerId);
    const pad = clampRect({ x: rect.x, y: rect.y, w: rect.w, h: rect.h }, doc.width, doc.height);
    // Carimbo pode cair parcialmente fora do doc — o clamp decide o que salvar
    // no histórico; o drawImage desenha e o que caiu fora simplesmente some.
    const beforeArea = pad ? ctx.getImageData(pad.x, pad.y, pad.w, pad.h) : null;
    ctx.drawImage(floatingCanvas, rect.x, rect.y);
    const afterArea = pad ? ctx.getImageData(pad.x, pad.y, pad.w, pad.h) : null;

    if (pad && beforeArea && afterArea) {
      doc.pushHistory({
        label: "stampSelection",
        bytes: beforeArea.data.byteLength * 2,
        undo: () => layerCtx(layerId).putImageData(beforeArea, pad.x, pad.y),
        redo: () => layerCtx(layerId).putImageData(afterArea, pad.x, pad.y),
      });
    }

    floatingCanvas = null;
    set({ rect: null, floating: false, floatingLayerId: null });
    requestRender();
  },

  deselect: () => {
    if (get().floating) {
      get().commit();
      return;
    }
    set({ rect: null });
    requestRender();
  },

  deleteContents: () => {
    const { rect, floating } = get();
    const doc = useDoc.getState();
    if (!rect || !doc.activeId) return;
    if (floating) {
      // Deletar um flutuante é só jogar os pixels fora — o corte já tem undo.
      floatingCanvas = null;
      set({ rect: null, floating: false, floatingLayerId: null });
      requestRender();
      return;
    }
    const layerId = doc.activeId;
    const ctx = layerCtx(layerId);
    const before = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
    ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
    const r0 = { ...rect };
    doc.pushHistory({
      label: "deleteSelection",
      bytes: before.data.byteLength,
      undo: () => layerCtx(layerId).putImageData(before, r0.x, r0.y),
      redo: () => layerCtx(layerId).clearRect(r0.x, r0.y, r0.w, r0.h),
    });
    requestRender();
  },
}));
