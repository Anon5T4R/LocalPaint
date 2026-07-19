/** Registro dos canvases de camada — os PIXELS moram aqui, fora do React.
 *
 *  Canvas não é imutável nem serializável; colocar num store faria cada traço
 *  de pincel atravessar o React. O zustand guarda só os metadados (model.ts);
 *  este módulo guarda o mapa id→canvas e as operações de pixel. Quem pinta
 *  chama `requestRender()` pra avisar o compositor (CanvasStage) que a tela
 *  envelheceu.
 */

export type LayerCanvas = HTMLCanvasElement;

const canvases = new Map<string, LayerCanvas>();

export function createLayerCanvas(id: string, w: number, h: number): LayerCanvas {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  canvases.set(id, c);
  return c;
}

export function getLayerCanvas(id: string): LayerCanvas | undefined {
  return canvases.get(id);
}

export function dropLayerCanvas(id: string) {
  canvases.delete(id);
}

export function clearAllLayerCanvases() {
  canvases.clear();
}

/** Contexto 2D da camada. `willReadFrequently`: o conta-gotas, o balde e o
 *  undo por dirty-rect fazem getImageData toda hora — sem a flag o Chrome
 *  fica migrando o backing store GPU↔CPU e serra a performance. */
export function layerCtx(id: string): CanvasRenderingContext2D {
  const c = canvases.get(id);
  if (!c) throw new Error(`camada ${id} sem canvas`);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas 2d indisponível");
  return ctx;
}

// ── sinal de render ─────────────────────────────────────────────────────────
// Um rAF por lote de mudanças: pintar 200 pontos num move só compõe uma vez.

let renderCb: (() => void) | null = null;
let pending = false;

export function onRender(cb: () => void) {
  renderCb = cb;
}

export function requestRender() {
  if (pending) return;
  pending = true;
  const run = () => {
    pending = false;
    renderCb?.();
  };
  // rAF NÃO dispara com o documento oculto (aba de fundo, janela minimizada
  // durante automação/testes) — o compositor congelaria e toda prova visual
  // daria zero. Oculto, cai pro setTimeout no mesmo ritmo; visível, rAF.
  if (typeof document !== "undefined" && document.hidden) {
    setTimeout(run, 16);
  } else {
    requestAnimationFrame(run);
  }
}
