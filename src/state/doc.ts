/** Store do documento — METADADOS (os pixels moram em lib/layers.ts).
 *
 *  Toda mutação estrutural de camada passa por aqui e registra o inverso no
 *  histórico. As mutações de PIXEL (traço, balde, forma) acontecem direto no
 *  canvas da camada; o CanvasStage captura o dirty-rect e registra via
 *  `pushHistory` — o store nem fica sabendo do conteúdo, só que sujou.
 */

import { create } from "zustand";

import {
  canRedo,
  canUndo,
  newHistory,
  push,
  redo as histRedo,
  undo as histUndo,
  type History,
  type HistoryEntry,
} from "../lib/history";
import {
  createLayerCanvas,
  dropLayerCanvas,
  getLayerCanvas,
  layerCtx,
  clearAllLayerCanvases,
  requestRender,
} from "../lib/layers";
import { newLayerMeta, nextLayerName, type LayerMeta } from "../lib/model";
import { t } from "../lib/i18n";

interface DocState {
  open: boolean;
  width: number;
  height: number;
  /** De baixo pra cima (índice 0 desenha primeiro). */
  layers: LayerMeta[];
  activeId: string | null;
  filePath: string | null;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;

  newDoc: (w: number, h: number, background: "white" | "transparent") => void;
  closeDoc: () => void;
  /** Monta o doc a partir de camadas já criadas no registro (abrir arquivo). */
  adoptDoc: (w: number, h: number, layers: LayerMeta[], filePath: string | null) => void;

  addLayer: () => void;
  /** Camada nova ACIMA da ativa com a imagem desenhada em (0,0) — a fatia ①
   *  "adicionar imagem como camada". Sem redimensionar: imagem maior que o
   *  doc fica cortada (centralizar/escalar é refinamento futuro anotado). */
  /** Devolve `true` quando a imagem precisou ser REDUZIDA pra caber no doc —
   *  quem chama avisa o usuário (encolher calado é perder pixel sem contar). */
  addImageLayer: (img: CanvasImageSource, name: string) => boolean;
  removeLayer: (id: string) => void;
  duplicateLayer: (id: string) => void;
  moveLayer: (id: string, dir: 1 | -1) => void;
  setLayerProps: (id: string, p: Partial<Pick<LayerMeta, "name" | "visible" | "opacity" | "blend">>) => void;
  setActive: (id: string) => void;
  /** Recorta o DOCUMENTO (todas as camadas) pro retângulo dado. */
  cropDoc: (r: { x: number; y: number; w: number; h: number }) => void;

  pushHistory: (e: HistoryEntry) => void;
  undo: () => void;
  redo: () => void;
  markDirty: () => void;
  markSaved: (path: string | null) => void;
}

let hist: History = newHistory();

function flags() {
  return { canUndo: canUndo(hist), canRedo: canRedo(hist), dirty: true };
}

export const useDoc = create<DocState>((set, get) => ({
  open: false,
  width: 0,
  height: 0,
  layers: [],
  activeId: null,
  filePath: null,
  dirty: false,
  canUndo: false,
  canRedo: false,

  newDoc: (w, h, background) => {
    clearAllLayerCanvases();
    hist = newHistory();
    const meta = newLayerMeta(t("layers.background"));
    createLayerCanvas(meta.id, w, h);
    if (background === "white") {
      const ctx = layerCtx(meta.id);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
    }
    set({
      open: true,
      width: w,
      height: h,
      layers: [meta],
      activeId: meta.id,
      filePath: null,
      dirty: false,
      canUndo: false,
      canRedo: false,
    });
    requestRender();
  },

  closeDoc: () => {
    clearAllLayerCanvases();
    hist = newHistory();
    set({
      open: false,
      width: 0,
      height: 0,
      layers: [],
      activeId: null,
      filePath: null,
      dirty: false,
      canUndo: false,
      canRedo: false,
    });
  },

  adoptDoc: (w, h, layers, filePath) => {
    hist = newHistory();
    set({
      open: true,
      width: w,
      height: h,
      layers,
      activeId: layers[layers.length - 1]?.id ?? null,
      filePath,
      dirty: false,
      canUndo: false,
      canRedo: false,
    });
    requestRender();
  },

  addLayer: () => {
    const { layers, width, height, activeId } = get();
    const meta = newLayerMeta(
      nextLayerName(
        layers.map((l) => l.name),
        t("layers.base"),
      ),
    );
    createLayerCanvas(meta.id, width, height);
    // Nova camada entra ACIMA da ativa (o que todo editor faz).
    const at = activeId ? layers.findIndex((l) => l.id === activeId) + 1 : layers.length;
    const next = [...layers.slice(0, at), meta, ...layers.slice(at)];
    set({ layers: next, activeId: meta.id, ...flags() });

    get().pushHistory({
      label: "addLayer",
      bytes: 0,
      undo: () => {
        dropLayerCanvas(meta.id);
        const s = useDoc.getState();
        useDoc.setState({
          layers: s.layers.filter((l) => l.id !== meta.id),
          activeId: s.activeId === meta.id ? (s.layers[at - 1]?.id ?? null) : s.activeId,
        });
      },
      redo: () => {
        createLayerCanvas(meta.id, width, height);
        const s = useDoc.getState();
        useDoc.setState({
          layers: [...s.layers.slice(0, at), meta, ...s.layers.slice(at)],
          activeId: meta.id,
        });
      },
    });
    requestRender();
  },

  addImageLayer: (img, name) => {
    const { layers, width, height, activeId, open } = get();
    if (!open) return false;
    const meta = newLayerMeta(name);
    createLayerCanvas(meta.id, width, height);
    // CENTRADO e reduzido pra caber. Desenhar em (0,0) no tamanho original
    // parece inofensivo e não é: uma foto maior que o doc seria CORTADA no canto
    // superior esquerdo — o usuário importa 4000 px num doc de 800 e recebe um
    // pedaço, sem aviso nenhum. Só encolhe (`min(1, …)`): ampliar uma imagem
    // pequena pra preencher o doc borraria pixel que o usuário não pediu.
    const iw = "width" in img ? Number(img.width) : width;
    const ih = "height" in img ? Number(img.height) : height;
    const fit = Math.min(1, width / iw, height / ih);
    const dw = Math.round(iw * fit);
    const dh = Math.round(ih * fit);
    layerCtx(meta.id).drawImage(img, Math.round((width - dw) / 2), Math.round((height - dh) / 2), dw, dh);
    const scaled = fit < 1;
    // Snapshot pro redo, padrão duplicateLayer: o CONTEÚDO tem que voltar —
    // refazer "adicionar imagem" sem os pixels seria uma camada vazia.
    const snap = layerCtx(meta.id).getImageData(0, 0, width, height);

    const at = activeId ? layers.findIndex((l) => l.id === activeId) + 1 : layers.length;
    const prevActive = activeId;
    const next = [...layers.slice(0, at), meta, ...layers.slice(at)];
    set({ layers: next, activeId: meta.id, ...flags() });

    get().pushHistory({
      label: "addImageLayer",
      bytes: snap.data.byteLength,
      undo: () => {
        dropLayerCanvas(meta.id);
        const s = useDoc.getState();
        useDoc.setState({
          layers: s.layers.filter((l) => l.id !== meta.id),
          activeId: s.activeId === meta.id ? (prevActive ?? (s.layers[at - 1]?.id ?? null)) : s.activeId,
        });
      },
      redo: () => {
        createLayerCanvas(meta.id, width, height);
        layerCtx(meta.id).putImageData(snap, 0, 0);
        const s = useDoc.getState();
        useDoc.setState({
          layers: [...s.layers.slice(0, at), meta, ...s.layers.slice(at)],
          activeId: meta.id,
        });
      },
    });
    requestRender();
    return scaled;
  },

  removeLayer: (id) => {
    const { layers, width, height } = get();
    if (layers.length <= 1) return; // última camada não sai — doc sem camada não existe
    const at = layers.findIndex((l) => l.id === id);
    if (at < 0) return;
    const meta = layers[at];
    // Guarda os pixels: o undo tem que devolver a camada COM o conteúdo.
    const snap = layerCtx(id).getImageData(0, 0, width, height);

    dropLayerCanvas(id);
    const next = layers.filter((l) => l.id !== id);
    set({ layers: next, activeId: next[Math.max(0, at - 1)].id, ...flags() });

    get().pushHistory({
      label: "removeLayer",
      bytes: snap.data.byteLength,
      undo: () => {
        createLayerCanvas(meta.id, width, height);
        layerCtx(meta.id).putImageData(snap, 0, 0);
        const s = useDoc.getState();
        useDoc.setState({
          layers: [...s.layers.slice(0, at), meta, ...s.layers.slice(at)],
          activeId: meta.id,
        });
      },
      redo: () => {
        dropLayerCanvas(meta.id);
        const s = useDoc.getState();
        const i = s.layers.findIndex((l) => l.id === meta.id);
        const rest = s.layers.filter((l) => l.id !== meta.id);
        useDoc.setState({ layers: rest, activeId: rest[Math.max(0, i - 1)]?.id ?? null });
      },
    });
    requestRender();
  },

  duplicateLayer: (id) => {
    const { layers, width, height } = get();
    const at = layers.findIndex((l) => l.id === id);
    if (at < 0) return;
    const src = getLayerCanvas(id);
    if (!src) return;
    const meta = { ...newLayerMeta(`${layers[at].name} ${t("layers.copySuffix")}`), visible: layers[at].visible, opacity: layers[at].opacity, blend: layers[at].blend };
    createLayerCanvas(meta.id, width, height);
    layerCtx(meta.id).drawImage(src, 0, 0);
    // Snapshot pro redo: a fonte pode mudar depois; duplicar de novo não é
    // a mesma coisa que repetir ESTA duplicação.
    const snap = layerCtx(meta.id).getImageData(0, 0, width, height);

    const next = [...layers.slice(0, at + 1), meta, ...layers.slice(at + 1)];
    set({ layers: next, activeId: meta.id, ...flags() });

    get().pushHistory({
      label: "duplicateLayer",
      bytes: snap.data.byteLength,
      undo: () => {
        dropLayerCanvas(meta.id);
        const s = useDoc.getState();
        useDoc.setState({
          layers: s.layers.filter((l) => l.id !== meta.id),
          activeId: id,
        });
      },
      redo: () => {
        createLayerCanvas(meta.id, width, height);
        layerCtx(meta.id).putImageData(snap, 0, 0);
        const s = useDoc.getState();
        const i = s.layers.findIndex((l) => l.id === id);
        useDoc.setState({
          layers: [...s.layers.slice(0, i + 1), meta, ...s.layers.slice(i + 1)],
          activeId: meta.id,
        });
      },
    });
    requestRender();
  },

  moveLayer: (id, dir) => {
    const { layers } = get();
    const at = layers.findIndex((l) => l.id === id);
    const to = at + dir;
    if (at < 0 || to < 0 || to >= layers.length) return;
    const next = [...layers];
    [next[at], next[to]] = [next[to], next[at]];
    set({ layers: next, ...flags() });

    const swap = (a: number, b: number) => {
      const s = useDoc.getState();
      const arr = [...s.layers];
      [arr[a], arr[b]] = [arr[b], arr[a]];
      useDoc.setState({ layers: arr });
    };
    get().pushHistory({
      label: "moveLayer",
      bytes: 0,
      undo: () => swap(to, at),
      redo: () => swap(at, to),
    });
    requestRender();
  },

  setLayerProps: (id, p) => {
    const { layers } = get();
    const at = layers.findIndex((l) => l.id === id);
    if (at < 0) return;
    const before = layers[at];
    const after = { ...before, ...p };
    const apply = (m: LayerMeta) => {
      const s = useDoc.getState();
      useDoc.setState({ layers: s.layers.map((l) => (l.id === id ? m : l)) });
      requestRender();
    };
    set({ layers: layers.map((l) => (l.id === id ? after : l)), ...flags() });

    get().pushHistory({
      label: "layerProps",
      bytes: 0,
      undo: () => apply(before),
      redo: () => apply(after),
    });
    requestRender();
  },

  setActive: (id) => set({ activeId: id }),

  cropDoc: (r) => {
    const { layers, width, height } = get();
    if (r.w < 1 || r.h < 1 || (r.x === 0 && r.y === 0 && r.w === width && r.h === height)) return;

    // Recorte muda TODAS as camadas e as dimensões do doc — o undo guarda o
    // doc inteiro (uma vez; é a operação mais cara do histórico e tudo bem:
    // o orçamento em bytes expulsa histórico velho se precisar).
    const snaps = layers.map((l) => ({
      id: l.id,
      img: layerCtx(l.id).getImageData(0, 0, width, height),
    }));

    const apply = (rect: { x: number; y: number; w: number; h: number }) => {
      for (const l of useDoc.getState().layers) {
        const c = getLayerCanvas(l.id);
        if (!c) continue;
        const cut = layerCtx(l.id).getImageData(rect.x, rect.y, rect.w, rect.h);
        c.width = rect.w;
        c.height = rect.h;
        layerCtx(l.id).putImageData(cut, 0, 0);
      }
      useDoc.setState({ width: rect.w, height: rect.h });
      requestRender();
    };

    apply(r);
    set({ ...flags() });

    get().pushHistory({
      label: "cropDoc",
      bytes: snaps.reduce((n, s) => n + s.img.data.byteLength, 0),
      undo: () => {
        for (const s of snaps) {
          const c = getLayerCanvas(s.id);
          if (!c) continue;
          c.width = width;
          c.height = height;
          layerCtx(s.id).putImageData(s.img, 0, 0);
        }
        useDoc.setState({ width, height });
        requestRender();
      },
      redo: () => {
        // Redo recorta de novo a partir do snapshot (a camada atual já está
        // recortada quando o redo roda depois de um undo — restaura e corta).
        for (const s of snaps) {
          const c = getLayerCanvas(s.id);
          if (!c) continue;
          c.width = width;
          c.height = height;
          layerCtx(s.id).putImageData(s.img, 0, 0);
        }
        apply(r);
      },
    });
  },

  pushHistory: (e) => {
    hist = push(hist, e);
    set({ canUndo: canUndo(hist), canRedo: canRedo(hist), dirty: true });
  },

  undo: () => {
    hist = histUndo(hist);
    set({ canUndo: canUndo(hist), canRedo: canRedo(hist), dirty: true });
    requestRender();
  },

  redo: () => {
    hist = histRedo(hist);
    set({ canUndo: canUndo(hist), canRedo: canRedo(hist), dirty: true });
    requestRender();
  },

  markDirty: () => set({ dirty: true }),
  markSaved: (filePath) => set({ dirty: false, filePath }),
}));
