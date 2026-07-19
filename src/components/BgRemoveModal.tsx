import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { fetchModel, MODEL_BYTES, modelPath, removeBackground } from "../lib/bgremove";
import { t } from "../lib/i18n";
import { getLayerCanvas, layerCtx, requestRender } from "../lib/layers";
import { useDoc } from "../state/doc";
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
 *  entra na camada ativa com undo de camada inteira — o mesmo before/after do
 *  `applyToActiveLayer` do FiltersModal, mas sempre a camada toda: a máscara
 *  vem do conteúdo inteiro, não faria sentido em recorte de seleção. */
export default function BgRemoveModal({ open, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [progress, setProgress] = useState<{ got: number; total: number | null } | null>(null);
  const pushToast = useUi((s) => s.pushToast);
  // O modal pode fechar no meio de um await; o ref evita setState em fantasma.
  const alive = useRef(false);

  const fail = (e: unknown) => {
    pushToast("error", t("bg.err", { err: String(e instanceof Error ? e.message : e) }));
    onClose();
  };

  const run = async () => {
    setPhase("running");
    try {
      const s = useDoc.getState();
      const layerId = s.activeId;
      const canvas = layerId ? getLayerCanvas(layerId) : undefined;
      if (!layerId || !canvas) throw new Error("no layer");
      const { width, height } = s;

      const ctx = layerCtx(layerId);
      const before = new Uint8ClampedArray(ctx.getImageData(0, 0, width, height).data);
      const result = await removeBackground(canvas);
      ctx.putImageData(result, 0, 0);
      const after = new Uint8ClampedArray(result.data);
      s.pushHistory({
        label: "bgremove",
        bytes: before.byteLength * 2,
        undo: () => layerCtx(layerId).putImageData(new ImageData(new Uint8ClampedArray(before), width, height), 0, 0),
        redo: () => layerCtx(layerId).putImageData(new ImageData(new Uint8ClampedArray(after), width, height), 0, 0),
      });
      requestRender();
      pushToast("ok", t("bg.done"));
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

  // Fechar no clique fora só quando nada está em andamento: abandonar o
  // download/inferência no meio deixaria trabalho órfão sem feedback.
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
          </>
        )}

        {phase === "running" && <p className="muted">{t("bg.running")}</p>}
      </div>
    </div>
  );
}
