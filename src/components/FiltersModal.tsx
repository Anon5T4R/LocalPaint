import { useEffect, useMemo, useRef, useState } from "react";

import { applyAdjust, boxBlur, grayscale, invert, isNeutral, NEUTRAL_ADJUST, sharpen, type Adjust } from "../lib/filters";
import { t } from "../lib/i18n";
import { getLayerCanvas, layerCtx, requestRender } from "../lib/layers";
import { useDoc } from "../state/doc";
import { useSelection } from "../state/selection";

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Aplica uma mutação de pixels na camada ativa com undo — na SELEÇÃO, se
 *  houver uma (não-flutuante); senão na camada inteira. Filtro não tem
 *  dirty-rect que preste (blur toca tudo que recebe) — paga a região e pronto;
 *  o orçamento do histórico cuida da memória. */
function applyToActiveLayer(label: string, fn: (data: Uint8ClampedArray, w: number, h: number) => void) {
  const s = useDoc.getState();
  if (!s.activeId) return;
  const layerId = s.activeId;
  const ctx = layerCtx(layerId);
  const sel = useSelection.getState();
  const region = sel.rect && !sel.floating ? sel.rect : { x: 0, y: 0, w: s.width, h: s.height };
  const { x: rx, y: ry, w: width, h: height } = region;
  const img = ctx.getImageData(rx, ry, width, height);
  const before = new Uint8ClampedArray(img.data);
  fn(img.data, width, height);
  ctx.putImageData(img, rx, ry);
  const after = new Uint8ClampedArray(img.data);
  s.pushHistory({
    label,
    bytes: before.byteLength * 2,
    undo: () => layerCtx(layerId).putImageData(new ImageData(new Uint8ClampedArray(before), width, height), rx, ry),
    redo: () => layerCtx(layerId).putImageData(new ImageData(new Uint8ClampedArray(after), width, height), rx, ry),
  });
  requestRender();
}

const PREVIEW_MAX = 260;

export default function FiltersModal({ open, onClose }: Props) {
  const activeId = useDoc((s) => s.activeId);
  const [adj, setAdj] = useState<Adjust>(NEUTRAL_ADJUST);
  const [blur, setBlur] = useState(0);
  const [sharp, setSharp] = useState(0);
  const previewRef = useRef<HTMLCanvasElement>(null);

  // Miniatura da camada ativa, tirada UMA vez ao abrir (base do preview).
  const base = useMemo(() => {
    if (!open || !activeId) return null;
    const src = getLayerCanvas(activeId);
    if (!src) return null;
    const scale = Math.min(1, PREVIEW_MAX / Math.max(src.width, src.height));
    const w = Math.max(1, Math.round(src.width * scale));
    const h = Math.max(1, Math.round(src.height * scale));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const cx = c.getContext("2d", { willReadFrequently: true })!;
    cx.drawImage(src, 0, 0, w, h);
    return { img: cx.getImageData(0, 0, w, h), w, h };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeId]);

  // Preview ao vivo: re-aplica os valores na miniatura a cada mudança. O blur
  // do preview escala pro tamanho da miniatura (senão o preview mente).
  useEffect(() => {
    const cv = previewRef.current;
    if (!open || !base || !cv) return;
    cv.width = base.w;
    cv.height = base.h;
    const data = new Uint8ClampedArray(base.img.data);
    applyAdjust(data, adj);
    if (blur > 0) {
      const srcMax = getLayerCanvas(activeId!)?.width ?? base.w;
      const factor = base.w / srcMax;
      boxBlur(data, base.w, base.h, Math.max(1, blur * factor));
    }
    if (sharp > 0) sharpen(data, base.w, base.h, sharp / 50);
    cv.getContext("2d")!.putImageData(new ImageData(data, base.w, base.h), 0, 0);
  }, [open, base, adj, blur, sharp, activeId]);

  // Zera os sliders sempre que o modal abre (filtro é gesto, não estado).
  useEffect(() => {
    if (open) {
      setAdj(NEUTRAL_ADJUST);
      setBlur(0);
      setSharp(0);
    }
  }, [open]);

  if (!open) return null;

  const apply = () => {
    const a = adj;
    const b = blur;
    const sp = sharp;
    if (isNeutral(a) && b === 0 && sp === 0) {
      onClose();
      return;
    }
    applyToActiveLayer("filters", (data, w, h) => {
      applyAdjust(data, a);
      if (b > 0) boxBlur(data, w, h, b);
      if (sp > 0) sharpen(data, w, h, sp / 50);
    });
    onClose();
  };

  const quick = (label: string, fn: (d: Uint8ClampedArray) => void) => {
    applyToActiveLayer(label, (data) => fn(data));
    onClose();
  };

  const slider = (
    label: string,
    value: number,
    min: number,
    max: number,
    set: (n: number) => void,
  ) => (
    <label className="tool-param filters-row">
      <span>{label}</span>
      <input type="range" min={min} max={max} value={value} onChange={(e) => set(Number(e.target.value))} />
      <b>{value}</b>
    </label>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal filters-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t("filters.title")}</h2>

        <div className="filters-body">
          <div className="filters-sliders">
            {slider(t("filters.brightness"), adj.brightness, -100, 100, (n) => setAdj({ ...adj, brightness: n }))}
            {slider(t("filters.contrast"), adj.contrast, -100, 100, (n) => setAdj({ ...adj, contrast: n }))}
            {slider(t("filters.saturation"), adj.saturation, -100, 100, (n) => setAdj({ ...adj, saturation: n }))}
            {slider(t("filters.hue"), adj.hue, -180, 180, (n) => setAdj({ ...adj, hue: n }))}
            {slider(t("filters.blur"), blur, 0, 40, setBlur)}
            {slider(t("filters.sharpen"), sharp, 0, 100, setSharp)}

            <div className="filters-quick">
              <button onClick={() => quick("grayscale", grayscale)}>{t("filters.grayscale")}</button>
              <button onClick={() => quick("invert", invert)}>{t("filters.invert")}</button>
            </div>
          </div>

          <div className="filters-preview">
            <canvas ref={previewRef} />
            <span className="muted small">{t("filters.previewNote")}</span>
          </div>
        </div>

        <div className="modal-actions">
          <button onClick={onClose}>{t("dlg.cancel")}</button>
          <button className="primary" onClick={apply}>
            {t("filters.apply")}
          </button>
        </div>
      </div>
    </div>
  );
}
