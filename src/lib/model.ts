/** Modelo do documento — TIPOS e regras puras, sem canvas.
 *
 *  A separação que sustenta o app inteiro: os PIXELS de cada camada vivem em
 *  canvases fora do estado React (ver `layers.ts` — canvas não é imutável nem
 *  serializável, não pertence a store); o que o zustand guarda é este modelo
 *  leve (metadados). Assim o painel de camadas re-renderiza barato e o traço
 *  de pincel não passa pelo React nunca.
 */

/** Blend modes expostos — nomes NOSSOS (persistidos no .tpaint), mapeados pro
 *  `globalCompositeOperation` na hora de compor. Não usar os nomes do canvas
 *  direto no formato: o formato sobrevive ao motor de render. */
export const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "difference",
  "soft-light",
  "hard-light",
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

/** normal→source-over; o resto coincide com o canvas (por isso a lista acima
 *  só tem modos que o canvas 2D compõe nativo — filtro de entrada, não acaso). */
export function blendToComposite(b: BlendMode): GlobalCompositeOperation {
  return b === "normal" ? "source-over" : (b as GlobalCompositeOperation);
}

export interface LayerMeta {
  id: string;
  name: string;
  visible: boolean;
  /** 0..1 */
  opacity: number;
  blend: BlendMode;
}

export interface DocMeta {
  width: number;
  height: number;
}

/** Teto de dimensão por eixo. 8192 cobre A3 a 300dpi e cabe num canvas 2D sem
 *  drama de memória (8192² RGBA = 256 MB por camada — já é o limite do bom
 *  senso no hardware alvo da suíte). */
export const MAX_DIM = 8192;
export const MIN_DIM = 1;

export function clampDim(n: number): number {
  if (!Number.isFinite(n)) return MIN_DIM;
  return Math.min(MAX_DIM, Math.max(MIN_DIM, Math.round(n)));
}

let nextId = 1;
/** Id único por sessão; ao abrir um .tpaint os ids do arquivo são mantidos e o
 *  contador salta pra depois deles (ver `bumpIdsPast`). */
export function newLayerId(): string {
  return `L${nextId++}`;
}

export function bumpIdsPast(ids: string[]) {
  for (const id of ids) {
    const m = /^L(\d+)$/.exec(id);
    if (m) nextId = Math.max(nextId, Number(m[1]) + 1);
  }
}

export function newLayerMeta(name: string): LayerMeta {
  return { id: newLayerId(), name, visible: true, opacity: 1, blend: "normal" };
}

/** Nome da próxima camada: "Camada N" com o menor N livre — remover a 2 e
 *  criar outra não pode dar duas "Camada 3". */
export function nextLayerName(existing: string[], base: string): string {
  let n = 1;
  const taken = new Set(existing);
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}
