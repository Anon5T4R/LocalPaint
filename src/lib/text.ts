/** Ferramenta de texto — texto QUEIMADO na camada, com undo por dirty-rect.
 *
 *  Decisão de escopo (registrada em docs/planos/localpaint.md): camada de
 *  texto EDITÁVEL exige tipo de camada polimórfico no modelo e no .tpaint —
 *  fica pra quando o formato ganhar a v2. Queimar com undo é o comportamento
 *  do Paint clássico e resolve o caso de uso de anotar/rotular já.
 */

import { rgbaToCss, type Rgba } from "./color";
import { clampRect } from "./geometry";
import { getLayerCanvas, layerCtx, requestRender } from "./layers";
import { useDoc } from "../state/doc";

export interface TextSpec {
  text: string;
  /** Tamanho da fonte em px do DOCUMENTO. */
  sizePx: number;
  color: Rgba;
  bold: boolean;
}

const LINE_GAP = 1.25;

/** Queima o texto na camada ativa com a âncora no clique (canto superior
 *  esquerdo da primeira linha). Devolve false se não havia onde queimar. */
export function burnText(x: number, y: number, spec: TextSpec): boolean {
  const s = useDoc.getState();
  if (!s.activeId || !spec.text.trim()) return false;
  const layerId = s.activeId;
  const src = getLayerCanvas(layerId);
  if (!src) return false;

  const ctx = layerCtx(layerId);
  const font = `${spec.bold ? "bold " : ""}${spec.sizePx}px "Segoe UI", system-ui, sans-serif`;

  // Mede ANTES de desenhar — o dirty-rect vem da medida, não de adivinhação.
  ctx.save();
  ctx.font = font;
  const lines = spec.text.replace(/\r\n?/g, "\n").split("\n");
  let w = 0;
  for (const line of lines) w = Math.max(w, ctx.measureText(line).width);
  const lineH = spec.sizePx * LINE_GAP;
  const h = lines.length * lineH;
  ctx.restore();

  // +margem pra descendentes (g, j) e anti-alias.
  const pad = Math.ceil(spec.sizePx * 0.4);
  const rect = clampRect({ x: x - pad, y: y - pad, w: w + 2 * pad, h: h + 2 * pad }, s.width, s.height);
  if (!rect) return false;

  const before = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);

  ctx.save();
  ctx.font = font;
  ctx.fillStyle = rgbaToCss(spec.color);
  ctx.textBaseline = "top";
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineH));
  ctx.restore();

  const after = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
  useDoc.getState().pushHistory({
    label: "text",
    bytes: before.data.byteLength * 2,
    undo: () => layerCtx(layerId).putImageData(before, rect.x, rect.y),
    redo: () => layerCtx(layerId).putImageData(after, rect.x, rect.y),
  });
  requestRender();
  return true;
}
