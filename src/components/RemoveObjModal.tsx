import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import type { AiPhase } from "../lib/aitypes";
import { cancelAi } from "../lib/aiworker";
import { t } from "../lib/i18n";
import { getLayerCanvas, layerCtx, requestRender } from "../lib/layers";
import { cancelFetch, fetchModel, MODEL_BYTES, modelPath, removeObject } from "../lib/removeobj";
import { useDoc } from "../state/doc";
import { useSelection } from "../state/selection";
import { useUi } from "../state/ui";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Phase = "checking" | "ask" | "downloading" | "running";

const MB = 1_048_576;
const mb = (n: number) => Math.round(n / MB);

/** Fluxo do "Remover objeto": com o LaMa no disco roda direto; sem ele,
 *  explica o download (~208 MB, uma vez) e mostra o progresso do evento
 *  `model-progress`, com Cancelar.
 *
 *  Diferente da remoção de fundo, aqui NÃO há modo de refino: o resultado é
 *  uma coisa só ("o objeto sumiu") e vira UMA entrada de undo do dirty-rect da
 *  janela processada — se não ficou bom, Ctrl+Z e tenta com outra seleção.
 *
 *  A SELEÇÃO CONTINUA VIVA depois de aplicar. É o que o Photoshop faz no
 *  Preencher > Sensível ao conteúdo, e é o comportamento útil: o caso comum de
 *  resultado ruim é "faltou pegar um pedaço", e resolver isso significa
 *  expandir a MESMA seleção e rodar de novo — perder a seleção obrigaria a
 *  refazê-la do zero justamente na hora em que ela é mais precisa.
 */
export default function RemoveObjModal({ open, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [progress, setProgress] = useState<{ got: number; total: number | null } | null>(null);
  // Sub-fase de `running`: carregando a sessão ou de fato inferindo. Só faz
  // sentido mostrar porque a thread principal agora está VIVA pra repintar —
  // na v0.9.0 um setState aqui não teria como chegar à tela.
  const [ai, setAi] = useState<AiPhase | null>(null);
  const pushToast = useUi((s) => s.pushToast);
  // O modal pode fechar no meio de um await; o ref evita setState em fantasma.
  const alive = useRef(false);

  const fail = (e: unknown) => {
    const msg = String(e instanceof Error ? e.message : e);
    // Cancelar é escolha do usuário, não falha — fecha calado.
    if (msg === "cancelado") {
      onClose();
      return;
    }
    // Motivo REAL, nunca "algo deu errado": sem modelo, erro de rede e erro de
    // inferência exigem ações diferentes do usuário.
    pushToast("error", t("obj.err", { err: msg }));
    onClose();
  };

  const run = async () => {
    setPhase("running");
    setAi(null);
    try {
      const doc = useDoc.getState();
      const { rect, mask } = useSelection.getState();
      const layerId = doc.activeId;
      const canvas = layerId ? getLayerCanvas(layerId) : undefined;
      if (!layerId || !canvas) throw new Error("no layer");
      if (!rect) throw new Error("no selection");

      const { crop, before, after, inferenceMs } = await removeObject(
        canvas,
        { bounds: rect, mask },
        doc.width,
        doc.height,
        (p) => {
          if (alive.current) setAi(p);
        },
      );

      const apply = () => {
        if (getLayerCanvas(layerId)) {
          layerCtx(layerId).putImageData(new ImageData(new Uint8ClampedArray(after.data), crop.w, crop.h), crop.x, crop.y);
        }
      };
      apply();
      // UMA entrada de undo pro resultado inteiro (as cópias são defensivas:
      // putImageData não consome o buffer, mas reusar o mesmo ImageData entre
      // undo e redo deixaria os dois apontando pro mesmo array).
      doc.pushHistory({
        label: "removeObject",
        bytes: before.data.byteLength * 2,
        undo: () => {
          if (getLayerCanvas(layerId)) {
            layerCtx(layerId).putImageData(new ImageData(new Uint8ClampedArray(before.data), crop.w, crop.h), crop.x, crop.y);
          }
        },
        redo: apply,
      });
      requestRender();
      pushToast("ok", t("obj.done", { s: (inferenceMs / 1000).toFixed(1) }));
      onClose();
    } catch (e) {
      fail(e);
    }
  };

  const download = async () => {
    setPhase("downloading");
    setProgress({ got: 0, total: MODEL_BYTES });
    const un = await listen<{ got: number; total: number | null }>("model-progress", (ev) => {
      if (alive.current) setProgress(ev.payload);
    });
    try {
      await fetchModel();
      un();
      if (alive.current) await run();
    } catch (e) {
      un();
      if (alive.current) fail(e);
    }
  };

  useEffect(() => {
    if (!open) return;
    alive.current = true;
    setPhase("checking");
    setProgress(null);
    void (async () => {
      try {
        const path = await modelPath();
        if (!alive.current) return;
        if (path) await run();
        else setPhase("ask");
      } catch (e) {
        if (alive.current) fail(e);
      }
    })();
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  // Fechar no clique fora só quando nada está em andamento: abandonar a
  // inferência no meio deixaria trabalho órfão sem feedback. O download tem
  // botão de Cancelar próprio (o Rust apaga o .tmp).
  const idle = phase === "ask";
  const pct = progress?.total ? Math.min(100, (progress.got / progress.total) * 100) : null;

  return (
    <div className="modal-backdrop" onClick={idle ? onClose : undefined}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t("obj.title")}</h2>

        {phase === "checking" && <p className="muted">{t("bg.checking")}</p>}

        {phase === "ask" && (
          <>
            <p className="muted">{t("obj.needModel", { size: mb(MODEL_BYTES) })}</p>
            <div className="modal-actions">
              <button onClick={onClose}>{t("dlg.cancel")}</button>
              <button className="primary" onClick={() => void download()}>
                {t("bg.download")}
              </button>
            </div>
          </>
        )}

        {phase === "downloading" && (
          <>
            <p className="muted">
              {t("bg.downloading", {
                got: mb(progress?.got ?? 0),
                total: progress?.total ? mb(progress.total) : "?",
              })}
            </p>
            <progress style={{ width: "100%" }} max={100} value={pct ?? undefined} />
            <div className="modal-actions">
              <button onClick={() => void cancelFetch()}>{t("dlg.cancel")}</button>
            </div>
          </>
        )}

        {/* Aviso de demora honesto: são dezenas de segundos em CPU, e a
            primeira vez ainda soma o parse dos 208 MB de pesos. O spinner
            GIRA (CSS, thread principal livre) e a fase diz em que ponto está
            — as duas coisas que a v0.9.0 não conseguia entregar porque a
            janela estava congelada. */}
        {phase === "running" && (
          <>
            <p className="muted spin-row">
              <span className="spinner" aria-hidden="true" />
              {ai === "loading" ? t("ai.loading") : t("obj.running")}
            </p>
            {/* Cancelar de VERDADE: mata o worker no meio do wasm. O preço
                (recarregar a sessão na próxima vez) está documentado em
                `aiworker.ts`; quem cancela quer sair agora. */}
            <div className="modal-actions">
              <button
                onClick={() => {
                  cancelAi();
                }}
              >
                {t("dlg.cancel")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
