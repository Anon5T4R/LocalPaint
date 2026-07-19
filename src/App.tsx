import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask } from "@tauri-apps/plugin-dialog";

import BgRemoveModal from "./components/BgRemoveModal";
import CanvasStage, { requestZoom } from "./components/CanvasStage";
import ColorPanel from "./components/ColorPanel";
import FiltersModal from "./components/FiltersModal";
import Icon from "./components/Icon";
import LayersPanel from "./components/LayersPanel";
import NewDocModal from "./components/NewDocModal";
import SettingsModal from "./components/SettingsModal";
import TextModal from "./components/TextModal";
import Toasts from "./components/Toasts";
import Toolbar from "./components/Toolbar";
import { t } from "./lib/i18n";
import { exportFlat, openPath, pickAndOpen, saveDoc, type ExportFormat } from "./lib/io";
import { useDoc } from "./state/doc";
import { useSelection } from "./state/selection";
import { useTools } from "./state/tools";
import { useUi } from "./state/ui";

export default function App() {
  const open = useDoc((s) => s.open);
  const dirty = useDoc((s) => s.dirty);
  const filePath = useDoc((s) => s.filePath);
  const canUndo = useDoc((s) => s.canUndo);
  const canRedo = useDoc((s) => s.canRedo);
  const undo = useDoc((s) => s.undo);
  const redo = useDoc((s) => s.redo);
  const pushToast = useUi((s) => s.pushToast);
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);

  const selRect = useSelection((s) => s.rect);
  const textAt = useTools((s) => s.textAt);
  const selFloating = useSelection((s) => s.floating);
  const [newOpen, setNewOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [bgOpen, setBgOpen] = useState(false);

  /** Ação que descarta o doc atual passa por aqui: pergunta se houver sujeira. */
  const guardUnsaved = async (): Promise<boolean> => {
    const s = useDoc.getState();
    if (!s.open || !s.dirty) return true;
    return ask(t("dlg.unsavedMsg"), { title: t("dlg.unsavedTitle"), kind: "warning" });
  };

  const doOpen = async () => {
    if (!(await guardUnsaved())) return;
    try {
      await pickAndOpen();
    } catch (e) {
      pushToast("error", t("io.openErr", { err: String(e instanceof Error ? e.message : e) }));
    }
  };

  const doSave = async (forceAsk = false) => {
    try {
      if (await saveDoc(forceAsk)) {
        const p = useDoc.getState().filePath;
        if (p) pushToast("ok", t("io.saved", { path: p }));
      }
    } catch (e) {
      pushToast("error", t("io.saveErr", { err: String(e instanceof Error ? e.message : e) }));
    }
  };

  const doExport = async (format: ExportFormat) => {
    setExportOpen(false);
    try {
      const p = await exportFlat(format);
      if (p) pushToast("ok", t("io.exported", { path: p }));
    } catch (e) {
      pushToast("error", t("io.saveErr", { err: String(e instanceof Error ? e.message : e) }));
    }
  };

  // Boot: arquivo por associação/CLI; e o mesmo pra 2ª instância. Guardado
  // por `inTauri` pro app abrir também em navegador puro (dev/smoke).
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    void invoke<string | null>("boot_open_path").then((p) => {
      if (p) {
        openPath(p).catch((e) =>
          useUi.getState().pushToast("error", t("io.openErr", { err: String(e instanceof Error ? e.message : e) })),
        );
      }
    });
    const un = listen<string>("open-path", (ev) => {
      void (async () => {
        if (!(await guardUnsaved())) return;
        openPath(ev.payload).catch((e) =>
          useUi.getState().pushToast("error", t("io.openErr", { err: String(e instanceof Error ? e.message : e) })),
        );
      })();
    });
    return () => {
      void un.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fechar a janela com alterações: pergunta. (`onCloseRequested` + destroy —
  // exige `core:window:allow-destroy` na capability, gotcha da suíte.)
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const win = getCurrentWindow();
    const un = win.onCloseRequested(async (e) => {
      const s = useDoc.getState();
      if (s.open && s.dirty) {
        e.preventDefault();
        const ok = await ask(t("dlg.unsavedMsg"), { title: t("dlg.unsavedTitle"), kind: "warning" });
        if (ok) await win.destroy();
      }
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // Atalhos globais do app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt instanceof HTMLInputElement || tgt instanceof HTMLTextAreaElement || tgt.isContentEditable) return;

      if (e.key === "Escape") {
        useSelection.getState().deselect();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        useSelection.getState().deleteContents();
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        // Antes do bloco sem-shift: Ctrl+Shift+I = inverter seleção (padrão
        // Photoshop). Não colide — Ctrl+I sozinho segue livre.
        if (k === "i" && e.shiftKey) {
          e.preventDefault();
          useSelection.getState().invert();
          return;
        }
        if (k === "a") {
          e.preventDefault();
          useSelection.getState().selectAll();
          return;
        }
        if (k === "d") {
          e.preventDefault();
          useSelection.getState().deselect();
          return;
        }
        if (k === "z" && !e.shiftKey) {
          e.preventDefault();
          if (useDoc.getState().canUndo) undo();
        } else if (k === "y" || (k === "z" && e.shiftKey)) {
          e.preventDefault();
          if (useDoc.getState().canRedo) redo();
        } else if (k === "s") {
          e.preventDefault();
          void doSave(e.shiftKey);
        } else if (k === "o") {
          e.preventDefault();
          void doOpen();
        } else if (k === "n") {
          e.preventDefault();
          void (async () => {
            if (await guardUnsaved()) setNewOpen(true);
          })();
        }
        return;
      }

      const tools = useTools.getState();
      const map: Record<string, () => void> = {
        m: () => tools.setTool("select"),
        w: () => tools.setTool("wand"),
        t: () => tools.setTool("text"),
        p: () => tools.setTool("pencil"),
        b: () => tools.setTool("brush"),
        e: () => tools.setTool("eraser"),
        g: () => tools.setTool("fill"),
        i: () => tools.setTool("eyedropper"),
        l: () => tools.setTool("line"),
        r: () => tools.setTool("rect"),
        o: () => tools.setTool("ellipse"),
        x: () => tools.swapColors(),
        "[": () => tools.setSize(tools.size - (tools.size > 20 ? 5 : 1)),
        "]": () => tools.setSize(tools.size + (tools.size >= 20 ? 5 : 1)),
      };
      map[e.key.toLowerCase()]?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fileLabel = filePath ? filePath.replace(/^.*[\\/]/, "") : t("top.untitled");

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <b>LocalPaint</b>
          <span className="muted">{t("top.tagline")}</span>
        </div>

        <div className="topbar-group">
          <button
            onClick={() => {
              void (async () => {
                if (await guardUnsaved()) setNewOpen(true);
              })();
            }}
          >
            <Icon name="file" /> {t("top.new")}
          </button>
          <button onClick={() => void doOpen()}>
            <Icon name="folder" /> {t("top.open")}
          </button>
          <button disabled={!open} onClick={() => void doSave(false)}>
            <Icon name="save" /> {t("top.save")}
          </button>
          <button disabled={!open} onClick={() => void doSave(true)}>
            {t("top.saveAs")}
          </button>
          <button disabled={!open} onClick={() => setExportOpen(true)}>
            <Icon name="export" /> {t("top.export")}
          </button>
          <button disabled={!open} onClick={() => setFiltersOpen(true)}>
            <Icon name="sliders" /> {t("top.filters")}
          </button>
          <button disabled={!open} title={t("top.removeBgTip")} onClick={() => setBgOpen(true)}>
            <Icon name="scissors" /> {t("top.removeBg")}
          </button>
        </div>

        <div className="topbar-group">
          <button disabled={!canUndo} title={t("top.undo")} onClick={undo}>
            <Icon name="undo" />
          </button>
          <button disabled={!canRedo} title={t("top.redo")} onClick={redo}>
            <Icon name="redo" />
          </button>
          <button disabled={!open} title={t("zoom.fit")} onClick={() => requestZoom("fit")}>
            <Icon name="fit" />
          </button>
          <button disabled={!open} title={t("zoom.hundred")} onClick={() => requestZoom("100")}>
            1:1
          </button>
          <button
            disabled={!selRect || selFloating}
            title={t("sel.invert")}
            onClick={() => useSelection.getState().invert()}
          >
            <Icon name="invert" />
          </button>
          <button
            disabled={!selRect || selFloating}
            title={t("top.cropTip")}
            onClick={() => {
              const r = useSelection.getState().rect;
              if (!r) return;
              useSelection.getState().deselect();
              useDoc.getState().cropDoc(r);
            }}
          >
            <Icon name="crop" /> {t("top.crop")}
          </button>
        </div>

        <div className="topbar-right">
          {open && (
            <span className="file-label muted" title={filePath ?? undefined}>
              {fileLabel}
              {dirty && <b className="dirty-dot" title={t("top.unsavedMark")} />}
            </span>
          )}
          <button title={t("top.settingsTitle")} onClick={() => setSettingsOpen(true)}>
            <Icon name="settings" />
          </button>
        </div>
      </header>

      <div className="body">
        <aside className="left">
          <Toolbar />
          <ColorPanel />
        </aside>

        <main className="center">
          {open ? (
            <CanvasStage />
          ) : (
            <div className="empty">
              <h2>{t("empty.title")}</h2>
              <p className="muted">{t("empty.hint")}</p>
              <div className="empty-actions">
                <button className="primary" onClick={() => setNewOpen(true)}>
                  <Icon name="file" /> {t("empty.new")}
                </button>
                <button onClick={() => void doOpen()}>
                  <Icon name="folder" /> {t("empty.open")}
                </button>
              </div>
            </div>
          )}
        </main>

        <aside className="right">{open && <LayersPanel />}</aside>
      </div>

      <NewDocModal open={newOpen} onClose={() => setNewOpen(false)} />
      <FiltersModal open={filtersOpen} onClose={() => setFiltersOpen(false)} />
      <BgRemoveModal open={bgOpen} onClose={() => setBgOpen(false)} />
      <TextModal at={textAt} onClose={() => useTools.getState().setTextAt(null)} />
      {exportOpen && (
        <div className="modal-backdrop" onClick={() => setExportOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t("export.title")}</h2>
            <p className="muted">{t("export.hint")}</p>
            <div className="modal-actions">
              <button className="primary" onClick={() => void doExport("png")}>
                PNG
              </button>
              <button onClick={() => void doExport("jpg")} title={t("export.jpgNote")}>
                JPG
              </button>
              <button onClick={() => void doExport("webp")}>WebP</button>
              <button onClick={() => setExportOpen(false)}>{t("dlg.cancel")}</button>
            </div>
          </div>
        </div>
      )}
      <SettingsModal />
      <Toasts />
    </div>
  );
}
