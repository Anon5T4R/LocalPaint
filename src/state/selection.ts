/** Seleção (retângulo OU máscara) — o estado e as operações que dependem dela.
 *
 *  Desde a fatia F2 a seleção é `{rect, mask}` na convenção de lib/mask.ts:
 *  `mask` é relativa ao rect (bounds) e `mask === null` significa retângulo
 *  cheio — o fast path que mantém o comportamento antigo byte a byte. Varinha
 *  e inverter produzem máscaras; o marquee segue produzindo `mask: null`.
 *
 *  O RECORTE FLUTUANTE (pixels levantados da camada durante um arrasto) mora
 *  num canvas de módulo, fora do zustand, pela mesma razão das camadas: canvas
 *  não é estado imutável. O store guarda só o retângulo, a máscara e a posição.
 *
 *  Modelo de commit (o mesmo dos editores raster): mover pela primeira vez
 *  CORTA os pixels da camada (undo próprio); soltar em outro lugar ainda é
 *  flutuante; desselecionar/trocar de ferramenta CARIMBA na camada ATIVA no
 *  momento do commit (undo próprio) — trocar de camada com o flutuante vivo
 *  é como se move recorte pra outra camada. Undo no meio devolve cada passo
 *  na ordem: o corte desfaz na ORIGEM, o carimbo desfaz no DESTINO.
 *
 *  Lição do achado 1 da v0.6.0: o undo/redo do CARIMBO precisa restaurar/
 *  limpar também o ESTADO flutuante, não só os pixels — senão a cadeia
 *  undo-tudo → redo-tudo termina com um flutuante fantasma (o redo do lift
 *  recria o flutuante e o redo do stamp só pintava pixels), e o fantasma
 *  carimbava DUPLICADO no próximo deselect.
 */

import { create } from "zustand";

import { clampRect, type Rect } from "../lib/geometry";
import { layerCtx, requestRender } from "../lib/layers";
import { applyMaskAlpha, clearMasked, dilateSel, erodeSel, invertSel, trimMask, type MaskSel } from "../lib/mask";
import { resolveStampTarget } from "../lib/stamp";
import { useDoc } from "./doc";

let floatingCanvas: HTMLCanvasElement | null = null;

export function getFloatingCanvas(): HTMLCanvasElement | null {
  return floatingCanvas;
}

interface SelectionState {
  /** Bounds da seleção em coordenadas de DOC (null = sem seleção). */
  rect: Rect | null;
  /** Máscara relativa ao rect (lib/mask.ts). null = retângulo cheio. */
  mask: Uint8Array | null;
  /** true = os pixels da seleção estão levantados (no canvas flutuante). */
  floating: boolean;
  /** De qual camada os pixels foram levantados (fallback do carimbo). */
  floatingLayerId: string | null;

  select: (r: Rect | null) => void;
  /** Seleção mascarada (varinha/inverter). Passa por trimMask — bounds justo,
   *  e máscara cheia degenera pro fast path de retângulo. */
  selectMask: (sel: MaskSel) => void;
  selectAll: () => void;
  /** Inverte a seleção dentro do doc (Ctrl+Shift+I). Sem seleção = no-op;
   *  seleção cobrindo o doc inteiro = seleção some. */
  invert: () => void;
  /** Expande a seleção N px (dilatação morfológica, clampada ao doc). */
  expand: (n: number) => void;
  /** Contrai a seleção N px (erosão). Contrair até sumir limpa a seleção. */
  contract: (n: number) => void;
  /** Levanta os pixels da camada ativa pro flutuante (início do arrasto).
   *  Com máscara: copia SÓ os pixels onde mask=1 e limpa SÓ eles na origem. */
  lift: () => void;
  moveBy: (dx: number, dy: number) => void;
  /** Carimba o flutuante e limpa a seleção. O destino é a camada ATIVA no
   *  momento do commit (regra de editor raster: mover recorte + trocar de
   *  camada = mover pra outra camada); `targetLayerId` força um destino
   *  explícito; a origem é só o fallback (lib/stamp.ts decide). */
  commit: (targetLayerId?: string) => void;
  /** Sem seleção não há o que fazer; com flutuante, carimba antes de limpar. */
  deselect: () => void;
  /** Apaga o conteúdo da seleção na camada ativa (Delete) — só o mascarado. */
  deleteContents: () => void;
}

export const useSelection = create<SelectionState>((set, get) => ({
  rect: null,
  mask: null,
  floating: false,
  floatingLayerId: null,

  select: (r) => {
    // Selecionar de novo com um flutuante pendurado primeiro assenta ele.
    if (get().floating) get().commit();
    const doc = useDoc.getState();
    const clamped = r ? clampRect(r, doc.width, doc.height) : null;
    set({ rect: clamped && clamped.w > 0 && clamped.h > 0 ? clamped : null, mask: null });
    requestRender();
  },

  selectMask: (sel) => {
    if (get().floating) get().commit();
    const doc = useDoc.getState();
    if (!doc.open) return;
    const trimmed = sel.mask ? trimMask(sel.bounds, sel.mask) : { bounds: sel.bounds, mask: null };
    if (!trimmed) {
      set({ rect: null, mask: null });
      requestRender();
      return;
    }
    const clamped = clampRect(trimmed.bounds, doc.width, doc.height);
    // A varinha só produz bounds dentro do doc; clamp aqui é cinto de segurança
    // (bounds parcialmente fora invalidaria o alinhamento da máscara — recusa).
    if (!clamped || clamped.w !== trimmed.bounds.w || clamped.h !== trimmed.bounds.h) {
      set({ rect: clamped, mask: null });
      requestRender();
      return;
    }
    set({ rect: trimmed.bounds, mask: trimmed.mask });
    requestRender();
  },

  selectAll: () => {
    if (get().floating) get().commit();
    const doc = useDoc.getState();
    if (!doc.open) return;
    set({ rect: { x: 0, y: 0, w: doc.width, h: doc.height }, mask: null });
    requestRender();
  },

  invert: () => {
    if (get().floating) get().commit();
    const { rect, mask } = get();
    const doc = useDoc.getState();
    if (!rect || !doc.open) return;
    const inv = invertSel({ bounds: rect, mask }, doc.width, doc.height);
    set(inv ? { rect: inv.bounds, mask: inv.mask } : { rect: null, mask: null });
    requestRender();
  },

  expand: (n) => {
    const { rect, mask, floating } = get();
    const doc = useDoc.getState();
    if (!rect || floating || !doc.open) return;
    const d = dilateSel({ bounds: rect, mask }, doc.width, doc.height, n);
    set({ rect: d.bounds, mask: d.mask });
    requestRender();
  },

  contract: (n) => {
    const { rect, mask, floating } = get();
    if (!rect || floating) return;
    const e = erodeSel({ bounds: rect, mask }, n);
    set(e ? { rect: e.bounds, mask: e.mask } : { rect: null, mask: null });
    requestRender();
  },

  lift: () => {
    const { rect, mask, floating } = get();
    const doc = useDoc.getState();
    if (!rect || floating || !doc.activeId) return;
    const layerId = doc.activeId;
    const ctx = layerCtx(layerId);

    const before = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
    const m0 = mask;

    // Flutuante = cópia do bounds com o alpha zerado FORA da máscara; origem
    // = bounds com os pixels DENTRO da máscara zerados. Com mask null os dois
    // degeneram exatamente no clearRect + cópia cheia de antes.
    const floatImg = new ImageData(new Uint8ClampedArray(before.data), rect.w, rect.h);
    if (m0) applyMaskAlpha(floatImg.data, m0);
    const clearedImg = m0 ? new ImageData(new Uint8ClampedArray(before.data), rect.w, rect.h) : null;
    if (m0 && clearedImg) clearMasked(clearedImg.data, m0);

    const makeFloating = () => {
      const c = document.createElement("canvas");
      c.width = rect.w;
      c.height = rect.h;
      c.getContext("2d")!.putImageData(floatImg, 0, 0);
      return c;
    };
    const clearOrigin = () => {
      if (clearedImg) layerCtx(layerId).putImageData(clearedImg, rect.x, rect.y);
      else layerCtx(layerId).clearRect(rect.x, rect.y, rect.w, rect.h);
    };

    floatingCanvas = makeFloating();
    clearOrigin();

    const r0 = { ...rect };
    doc.pushHistory({
      label: "liftSelection",
      // Com máscara são 3 buffers do bounds (before + flutuante + origem limpa).
      bytes: before.data.byteLength * (m0 ? 3 : 2),
      // Undo do corte: devolve os pixels E desfaz o estado flutuante — sem
      // isso, o usuário desfaz e fica um fantasma pendurado no mouse.
      undo: () => {
        layerCtx(layerId).putImageData(before, r0.x, r0.y);
        floatingCanvas = null;
        useSelection.setState({ rect: r0, mask: m0, floating: false, floatingLayerId: null });
      },
      redo: () => {
        clearOrigin();
        floatingCanvas = makeFloating();
        useSelection.setState({ rect: r0, mask: m0, floating: true, floatingLayerId: layerId });
      },
    });

    set({ floating: true, floatingLayerId: layerId });
    requestRender();
  },

  moveBy: (dx, dy) => {
    const { rect } = get();
    if (!rect) return;
    set({ rect: { ...rect, x: rect.x + dx, y: rect.y + dy } });
    requestRender();
  },

  commit: (targetLayerId) => {
    const { rect, mask, floating, floatingLayerId } = get();
    if (!rect || !floating || !floatingLayerId || !floatingCanvas) {
      set({ rect: null, mask: null, floating: false, floatingLayerId: null });
      requestRender();
      return;
    }
    const doc = useDoc.getState();
    // Destino: explícito → ativa → origem (ids mortos são pulados).
    const layerId = resolveStampTarget({
      explicit: targetLayerId,
      activeId: doc.activeId,
      floatingLayerId,
      layerIds: doc.layers.map((l) => l.id),
    });
    if (!layerId) return;

    const ctx = layerCtx(layerId);
    const pad = clampRect({ x: rect.x, y: rect.y, w: rect.w, h: rect.h }, doc.width, doc.height);
    // Carimbo pode cair parcialmente fora do doc — o clamp decide o que salvar
    // no histórico; o drawImage desenha e o que caiu fora simplesmente some.
    const beforeArea = pad ? ctx.getImageData(pad.x, pad.y, pad.w, pad.h) : null;
    ctx.drawImage(floatingCanvas, rect.x, rect.y);
    const afterArea = pad ? ctx.getImageData(pad.x, pad.y, pad.w, pad.h) : null;

    if (pad && beforeArea && afterArea) {
      // O canvas flutuante fica vivo na closure — o undo devolve o estado
      // flutuante INTEIRO (fantasma de volta na mão), e o redo limpa de novo.
      // Ver o doc do módulo (achado 1 da v0.6.0).
      const fc = floatingCanvas;
      const r0 = { ...rect };
      const m0 = mask;
      const srcId = floatingLayerId;
      doc.pushHistory({
        label: "stampSelection",
        bytes: beforeArea.data.byteLength * 2,
        undo: () => {
          layerCtx(layerId).putImageData(beforeArea, pad.x, pad.y);
          floatingCanvas = fc;
          useSelection.setState({ rect: r0, mask: m0, floating: true, floatingLayerId: srcId });
        },
        redo: () => {
          layerCtx(layerId).putImageData(afterArea, pad.x, pad.y);
          floatingCanvas = null;
          useSelection.setState({ rect: null, mask: null, floating: false, floatingLayerId: null });
        },
      });
    }

    floatingCanvas = null;
    set({ rect: null, mask: null, floating: false, floatingLayerId: null });
    requestRender();
  },

  deselect: () => {
    if (get().floating) {
      get().commit();
      return;
    }
    set({ rect: null, mask: null });
    requestRender();
  },

  deleteContents: () => {
    const { rect, mask, floating } = get();
    const doc = useDoc.getState();
    if (!rect || !doc.activeId) return;
    if (floating) {
      // Deletar um flutuante é só jogar os pixels fora — o corte já tem undo.
      floatingCanvas = null;
      set({ rect: null, mask: null, floating: false, floatingLayerId: null });
      requestRender();
      return;
    }
    const layerId = doc.activeId;
    const ctx = layerCtx(layerId);
    const before = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
    const m0 = mask;
    const clearNow = () => {
      if (m0) {
        const cleared = new ImageData(new Uint8ClampedArray(before.data), rect.w, rect.h);
        clearMasked(cleared.data, m0);
        layerCtx(layerId).putImageData(cleared, rect.x, rect.y);
      } else {
        layerCtx(layerId).clearRect(rect.x, rect.y, rect.w, rect.h);
      }
    };
    clearNow();
    const r0 = { ...rect };
    doc.pushHistory({
      label: "deleteSelection",
      bytes: before.data.byteLength,
      undo: () => layerCtx(layerId).putImageData(before, r0.x, r0.y),
      redo: clearNow,
    });
    requestRender();
  },
}));
