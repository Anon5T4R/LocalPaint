import { t } from "../lib/i18n";
import { useObjMask } from "../state/objmask";
import { useTools } from "../state/tools";

/** Barra contextual do modo "pintar a máscara" do remover objeto (flutua no
 *  topo do palco enquanto o modo vive). Mesmas classes da RefineBar de
 *  propósito: pro usuário são o MESMO gesto ("pinto a máscara e aplico") e
 *  parecer diferente seria a UI mentindo sobre isso.
 *
 *  O contador de pixels não é enfeite: pintar véu vermelho sobre foto vermelha
 *  engana o olho, e o número é o que diz "tem máscara aqui" — é também ele que
 *  desabilita o Aplicar quando não há nada pra remover. */
export default function ObjMaskBar() {
  const active = useObjMask((s) => s.active);
  const mode = useObjMask((s) => s.mode);
  const painted = useObjMask((s) => s.painted);
  const size = useTools((s) => s.size);
  if (!active) return null;
  const st = useObjMask.getState();

  return (
    <div className="refine-bar" title={t("objmask.hint")}>
      <b>{t("objmask.title")}</b>
      <div className="segmented">
        <button className={mode === "paint" ? "active" : ""} onClick={() => st.setMode("paint")}>
          {t("objmask.paint")}
        </button>
        <button className={mode === "erase" ? "active" : ""} onClick={() => st.setMode("erase")}>
          {t("objmask.erase")}
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
      <span className="refine-param">
        <b>{t("objmask.painted", { n: painted })}</b>
      </span>
      <button className="primary" disabled={painted === 0} onClick={() => st.arm()}>
        {t("objmask.apply")}
      </button>
      <button onClick={() => st.cancel()}>{t("dlg.cancel")}</button>
    </div>
  );
}
