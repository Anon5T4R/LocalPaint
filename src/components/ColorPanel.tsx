import Icon from "./Icon";
import { hexToRgba, rgbaToCss, rgbaToHex, type Rgba } from "../lib/color";
import { t } from "../lib/i18n";
import { useTools } from "../state/tools";

/** Paleta fixa — as 16 do Paint clássico + uns tons úteis. Cores de UI não se
 *  traduzem nem se tematizam: são DADO, não chrome. */
const PALETTE: string[] = [
  "#000000", "#464646", "#787878", "#b4b4b4", "#ffffff",
  "#d10000", "#ff7d00", "#ffd800", "#5aa02c", "#00b4c8",
  "#0046d1", "#7d00b4", "#ff64c8", "#8b4513", "#ffc8a0",
  "#1e1e2e",
];

export default function ColorPanel() {
  const primary = useTools((s) => s.primary);
  const secondary = useTools((s) => s.secondary);
  const setPrimary = useTools((s) => s.setPrimary);
  const setSecondary = useTools((s) => s.setSecondary);
  const swap = useTools((s) => s.swapColors);
  const recent = useTools((s) => s.recent);

  const pick = (c: Rgba, e: React.MouseEvent) => {
    // Clique normal muda a primária; com Ctrl (ou botão direito, tratado no
    // onContextMenu) muda a secundária — o padrão dos editores raster.
    if (e.ctrlKey) setSecondary(c);
    else setPrimary(c);
  };

  return (
    <div className="color-panel">
      <div className="color-current">
        <div className="swatch-stack" title={`${t("color.primary")} / ${t("color.secondary")}`}>
          <label className="swatch primary" style={{ background: rgbaToCss(primary) }}>
            <input
              type="color"
              value={rgbaToHex(primary)}
              onChange={(e) => {
                const c = hexToRgba(e.target.value);
                if (c) setPrimary(c);
              }}
            />
          </label>
          <label className="swatch secondary" style={{ background: rgbaToCss(secondary) }}>
            <input
              type="color"
              value={rgbaToHex(secondary)}
              onChange={(e) => {
                const c = hexToRgba(e.target.value);
                if (c) setSecondary(c);
              }}
            />
          </label>
        </div>
        <button className="icon-btn" title={t("color.swap")} onClick={swap}>
          <Icon name="swap" />
        </button>
      </div>

      <div className="palette">
        {PALETTE.map((hex) => {
          const c = hexToRgba(hex);
          return (
            <button
              key={hex}
              className="palette-cell"
              style={{ background: hex }}
              onClick={(e) => c && pick(c, e)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (c) setSecondary(c);
              }}
            />
          );
        })}
      </div>

      {recent.length > 0 && (
        <>
          <div className="muted small">{t("color.recent")}</div>
          <div className="palette">
            {recent.map((c, i) => (
              <button
                key={i}
                className="palette-cell"
                style={{ background: rgbaToCss(c) }}
                onClick={(e) => pick(c, e)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setSecondary(c);
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
