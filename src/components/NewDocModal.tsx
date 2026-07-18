import { useState } from "react";

import { t } from "../lib/i18n";
import { clampDim } from "../lib/model";
import { useDoc } from "../state/doc";

/** Presets de tamanho — os que um usuário de Paint realmente cria. */
const PRESETS: { label: string; w: number; h: number }[] = [
  { label: "1280 × 720", w: 1280, h: 720 },
  { label: "1920 × 1080", w: 1920, h: 1080 },
  { label: "1080 × 1080", w: 1080, h: 1080 },
  { label: "A4 · 300dpi", w: 2480, h: 3508 },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function NewDocModal({ open, onClose }: Props) {
  const newDoc = useDoc((s) => s.newDoc);
  const [w, setW] = useState(1280);
  const [h, setH] = useState(720);
  const [bg, setBg] = useState<"white" | "transparent">("white");

  if (!open) return null;

  const create = () => {
    newDoc(clampDim(w), clampDim(h), bg);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t("new.title")}</h2>

        <div className="settings-row">
          <span>{t("new.presets")}</span>
          <div className="segmented">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                className={w === p.w && h === p.h ? "active" : ""}
                onClick={() => {
                  setW(p.w);
                  setH(p.h);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-row">
          <span>{t("new.width")}</span>
          <input
            type="number"
            min={1}
            max={8192}
            value={w}
            onChange={(e) => setW(Number(e.target.value))}
          />
          <span className="muted">{t("new.px")}</span>
          <span>{t("new.height")}</span>
          <input
            type="number"
            min={1}
            max={8192}
            value={h}
            onChange={(e) => setH(Number(e.target.value))}
          />
          <span className="muted">{t("new.px")}</span>
        </div>

        <div className="settings-row">
          <span>{t("new.background")}</span>
          <div className="segmented">
            <button className={bg === "white" ? "active" : ""} onClick={() => setBg("white")}>
              {t("new.bgWhite")}
            </button>
            <button className={bg === "transparent" ? "active" : ""} onClick={() => setBg("transparent")}>
              {t("new.bgTransparent")}
            </button>
          </div>
        </div>

        <div className="modal-actions">
          <button onClick={onClose}>{t("dlg.cancel")}</button>
          <button className="primary" onClick={create} autoFocus>
            {t("new.create")}
          </button>
        </div>
      </div>
    </div>
  );
}
