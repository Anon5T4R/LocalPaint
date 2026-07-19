import { t } from "../lib/i18n";
import { useRefine } from "../state/refine";
import { useTools } from "../state/tools";

/** Barra contextual do modo REFINAR (flutua no topo do palco enquanto o modo
 *  vive). Pincel Restaurar/Apagar (botão direito inverte na hora), tamanho
 *  (o MESMO do pincel normal — useTools.size), "Suavizar borda" (blur da
 *  máscara), véu opcional, Aplicar (Enter) / Cancelar (Esc). */
export default function RefineBar() {
  const active = useRefine((s) => s.active);
  const mode = useRefine((s) => s.mode);
  const smooth = useRefine((s) => s.smooth);
  const veil = useRefine((s) => s.veil);
  const size = useTools((s) => s.size);
  if (!active) return null;
  const st = useRefine.getState();

  return (
    <div className="refine-bar" title={t("refine.hint")}>
      <b>{t("refine.title")}</b>
      <div className="segmented">
        <button className={mode === "restore" ? "active" : ""} onClick={() => st.setMode("restore")}>
          {t("refine.restore")}
        </button>
        <button className={mode === "erase" ? "active" : ""} onClick={() => st.setMode("erase")}>
          {t("refine.erase")}
        </button>
      </div>
      <label className="refine-param">
        <span>{t("tool.size")}</span>
        <input
          type="range"
          min={1}
          max={200}
          value={size}
          onChange={(e) => useTools.getState().setSize(Number(e.target.value))}
        />
        <b>{size}</b>
      </label>
      <label className="refine-param">
        <span>{t("refine.smooth")}</span>
        <input type="range" min={0} max={30} value={smooth} onChange={(e) => st.setSmooth(Number(e.target.value))} />
        <b>{smooth}</b>
      </label>
      <label className="refine-check">
        <input type="checkbox" checked={veil} onChange={(e) => st.setVeil(e.target.checked)} />
        <span>{t("refine.veil")}</span>
      </label>
      <button className="primary" onClick={() => st.apply()}>
        {t("refine.apply")}
      </button>
      <button onClick={() => st.cancel()}>{t("dlg.cancel")}</button>
    </div>
  );
}
