import { useState } from "react";

import Icon from "./Icon";
import { t } from "../lib/i18n";
import { pickAndAddImageLayer } from "../lib/io";
import { BLEND_MODES, type BlendMode } from "../lib/model";
import { useDoc } from "../state/doc";
import { useSelection } from "../state/selection";
import { useUi } from "../state/ui";

/** Painel de camadas — a lista é DE CIMA PRA BAIXO na tela (a camada do topo
 *  da lista é a que cobre as outras), então renderiza o array invertido.
 *
 *  Com um recorte FLUTUANTE vivo, o painel vira também o seletor de DESTINO:
 *  clicar numa camada troca a ativa E marca visualmente que o assentamento
 *  (Esc/clique fora) vai carimbar nela — é assim que se move uma seleção pra
 *  outra camada. */
export default function LayersPanel() {
  const layers = useDoc((s) => s.layers);
  const activeId = useDoc((s) => s.activeId);
  const floating = useSelection((s) => s.floating);
  const commitSel = useSelection((s) => s.commit);
  const setActive = useDoc((s) => s.setActive);
  const addLayer = useDoc((s) => s.addLayer);
  const removeLayer = useDoc((s) => s.removeLayer);
  const duplicateLayer = useDoc((s) => s.duplicateLayer);
  const moveLayer = useDoc((s) => s.moveLayer);
  const setLayerProps = useDoc((s) => s.setLayerProps);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const active = layers.find((l) => l.id === activeId);
  const top = [...layers].reverse();

  const commitRename = () => {
    if (editingId && draft.trim()) setLayerProps(editingId, { name: draft.trim() });
    setEditingId(null);
  };

  return (
    <div className="layers-panel">
      <div className="panel-head">
        <b>{t("layers.title")}</b>
        <div className="panel-actions">
          <button className="icon-btn" title={t("layers.add")} onClick={addLayer}>
            <Icon name="plus" />
          </button>
          <button
            className="icon-btn"
            title={t("top.addImageTip")}
            onClick={() => {
              pickAndAddImageLayer().catch((e) =>
                useUi.getState().pushToast("error", t("io.openErr", { err: String(e instanceof Error ? e.message : e) })),
              );
            }}
          >
            <Icon name="image" />
          </button>
          <button
            className="icon-btn"
            title={t("layers.duplicate")}
            disabled={!activeId}
            onClick={() => activeId && duplicateLayer(activeId)}
          >
            <Icon name="copy" />
          </button>
          <button
            className="icon-btn"
            title={t("layers.up")}
            disabled={!activeId}
            onClick={() => activeId && moveLayer(activeId, 1)}
          >
            <Icon name="up" />
          </button>
          <button
            className="icon-btn"
            title={t("layers.down")}
            disabled={!activeId}
            onClick={() => activeId && moveLayer(activeId, -1)}
          >
            <Icon name="down" />
          </button>
          <button
            className="icon-btn danger"
            title={t("layers.remove")}
            disabled={!activeId || layers.length <= 1}
            onClick={() => activeId && removeLayer(activeId)}
          >
            <Icon name="trash" />
          </button>
        </div>
      </div>

      {floating && active && (
        <button
          className="stamp-banner"
          title={t("sel.stampTip")}
          onClick={() => commitSel()}
        >
          {t("sel.stampTo", { name: active.name })}
        </button>
      )}

      <div className="layers-list">
        {top.map((l) => (
          <div
            key={l.id}
            className={`layer-row${l.id === activeId ? " active" : ""}${floating && l.id === activeId ? " stamp-target" : ""}`}
            title={floating && l.id === activeId ? t("sel.stampHint") : undefined}
            onClick={() => setActive(l.id)}
          >
            <button
              className="icon-btn"
              title={t("layers.toggleVis")}
              onClick={(e) => {
                e.stopPropagation();
                setLayerProps(l.id, { visible: !l.visible });
              }}
            >
              <Icon name={l.visible ? "eye" : "eyeOff"} />
            </button>
            {editingId === l.id ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setEditingId(null);
                }}
              />
            ) : (
              <span
                className={`layer-name${l.visible ? "" : " muted"}`}
                title={t("layers.renameHint")}
                onDoubleClick={() => {
                  setEditingId(l.id);
                  setDraft(l.name);
                }}
              >
                {l.name}
              </span>
            )}
          </div>
        ))}
      </div>

      {active && (
        <div className="layer-props">
          <label className="tool-param">
            <span>{t("layers.opacity")}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(active.opacity * 100)}
              onChange={(e) => setLayerProps(active.id, { opacity: Number(e.target.value) / 100 })}
            />
            <b>{Math.round(active.opacity * 100)}%</b>
          </label>
          <label className="tool-param">
            <span>{t("layers.blend")}</span>
            <select
              value={active.blend}
              onChange={(e) => setLayerProps(active.id, { blend: e.target.value as BlendMode })}
            >
              {BLEND_MODES.map((b) => (
                <option key={b} value={b}>
                  {t(`blend.${b}` as `blend.${BlendMode}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
