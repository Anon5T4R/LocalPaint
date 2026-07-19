import { useEffect, useState } from "react";

import { burnText } from "../lib/text";
import { t } from "../lib/i18n";
import { useTools } from "../state/tools";

interface Props {
  /** Posição do clique em coordenadas de DOC (null = fechado). */
  at: { x: number; y: number } | null;
  onClose: () => void;
}

/** Diálogo da ferramenta de texto: escreve, escolhe tamanho/negrito, e o
 *  texto queima na camada ativa na posição clicada (cor = primária). */
export default function TextModal({ at, onClose }: Props) {
  const primary = useTools((s) => s.primary);
  const [text, setText] = useState("");
  const [size, setSize] = useState(32);
  const [bold, setBold] = useState(false);

  useEffect(() => {
    if (at) setText("");
  }, [at]);

  if (!at) return null;

  const confirm = () => {
    burnText(at.x, at.y, { text, sizePx: size, color: primary, bold });
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t("text.title")}</h2>
        <textarea
          autoFocus
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Ctrl+Enter confirma; Enter cru continua sendo quebra de linha.
            if (e.key === "Enter" && e.ctrlKey) confirm();
            if (e.key === "Escape") onClose();
          }}
          placeholder={t("text.placeholder")}
          style={{ width: "100%", resize: "vertical", font: "inherit" }}
        />
        <div className="settings-row">
          <span>{t("text.size")}</span>
          <input type="range" min={8} max={200} value={size} onChange={(e) => setSize(Number(e.target.value))} />
          <b>{size}px</b>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={bold} onChange={(e) => setBold(e.target.checked)} />
            {t("text.bold")}
          </label>
        </div>
        <p className="muted small">{t("text.hint")}</p>
        <div className="modal-actions">
          <button onClick={onClose}>{t("dlg.cancel")}</button>
          <button className="primary" disabled={!text.trim()} onClick={confirm}>
            {t("text.apply")}
          </button>
        </div>
      </div>
    </div>
  );
}
