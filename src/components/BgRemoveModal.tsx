import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import type { AiPhase } from "../lib/aitypes";
import { cancelAi } from "../lib/aiworker";
import { cancelFetch, fetchModel, MODEL_BYTES, modelPath, removeBackground } from "../lib/bgremove";
import { t } from "../lib/i18n";
import { getLayerCanvas } from "../lib/layers";
import { useDoc } from "../state/doc";
import { useRefine } from "../state/refine";
import { useUi } from "../state/ui";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Phase = "checking" | "ask" | "downloading" | "running";

const MB = 1_048_576;
const mb = (n: number) => Math.round(n / MB);

/** Fluxo da remoção de fundo: com o modelo no disco, roda direto (o modal só
 *  mostra "removendo…"); sem ele, explica o download (~170 MB, uma vez, tudo
 *  local depois) e mostra o progresso do evento `model-progress`. O resultado
 *  NÃO é aplicado aqui: a inferência devolve `{ original, mask }` e o app
 *  entra no modo REFINAR (state/refine.ts) — pincel restaura/apaga a máscara,
 *  Enter aplica com UM undo, Esc cancela sem tocar a camada. */
export default function BgRemoveModal({ open, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [progress, setProgress] = useState<{ got: number; total: number | null } | null>(null);
  // Sub-fase de `running` (carregando a sessão × inferindo) — ver o mesmo
  // comentário no RemoveObjModal.
  const [ai, setAi] = useState<AiPhase | null>(null);
  const pushToast = useUi((s) => s.pushToast);
  // O modal pode fechar no meio de um await; o ref evita setState em fantasma.
  const alive = useRef(false);

  const fail = (e: unknown) => {
    const msg = String(e instanceof Error ? e.message : e);
    // Cancelar o download é escolha do usuário, não falha — fecha calado.
    if (msg === "cancelado") {
      onClose();
      return;
    }
    pushToast("error", t("bg.err", { err: msg }));
    onClose();
  };

  const run = async () => {
    setPhase("running");
    setAi(null);
    try {
      const s = useDoc.getState();
      const layerId = s.activeId;
      const canvas = layerId ? getLayerCanvas(layerId) : undefined;
      if (!layerId || !canvas) throw new Error("no layer");

      const { original, mask } = await removeBackground(canvas, (p) => {
        if (alive.current) setAi(p);
      });
      // Nada de histórico aqui — o Aplicar do modo Refinar grava o undo único.
      useRefine.getState().start(layerId, original, mask);
      pushToast("ok", t("bg.refineStart"));
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
        <h2>{t("bg.title")}</h2>

        {phase === "checking" && <p className="muted">{t("bg.checking")}</p>}

        {phase === "ask" && (
          <>
            <p className="muted">{t("bg.needModel", { size: mb(MODEL_BYTES) })}</p>
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

        {/* Spinner girando + fase + Cancelar real — a inferência mudou de
            thread na v0.10.0 e a janela agora consegue repintar durante ela. */}
        {phase === "running" && (
          <>
            <p className="muted spin-row">
              <span className="spinner" aria-hidden="true" />
              {ai === "loading" ? t("ai.loading") : t("bg.running")}
            </p>
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
