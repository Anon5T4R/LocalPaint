import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";
import { useLocale } from "./lib/i18n";
import { applyTheme, useUi } from "./state/ui";

// Aplica o tema salvo antes do 1º render (evita flash) e segue a mídia do SO
// enquanto o usuário estiver em "system".
applyTheme(useUi.getState().theme);
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (useUi.getState().theme === "system") applyTheme("system");
});

// Ponte de automação — SÓ EM DEV (padrão da suíte, igual LocalVideo): expõe as
// stores e o registro de camadas no `window` pra prova dirigida por CDP sem
// diálogo nativo. Em produção o bundler apaga o bloco — não vai um byte.
if (import.meta.env.DEV) {
  void Promise.all([
    import("./state/doc"),
    import("./state/tools"),
    import("./lib/layers"),
    import("./state/selection"),
    import("./state/refine"),
    import("./state/objmask"),
    import("./lib/maskpaint"),
  ]).then(
    ([d, tl, ly, sl, rf, om, mp]) => {
      (window as unknown as Record<string, unknown>).__lp = {
        doc: d.useDoc,
        tools: tl.useTools,
        layers: ly,
        selection: sl.useSelection,
        refine: rf.useRefine,
        // Fatia ⑦: o modo de pintar máscara. A ponte expõe o STORE e o
        // BUFFER cru — a prova de GUI mede em pixels (quantos o traço marcou,
        // quanto a borracha subtraiu, se a seleção-guia entrou certa), e isso
        // não dá pra ler de screenshot.
        objmask: om.useObjMask,
        objmaskBuf: om.getObjMaskBuffer,
        objmaskCanvas: om.getObjMaskCanvas,
        objmaskSel: om.getObjMaskSel,
        maskpaint: mp,
        // Prova do backend do ORT sem precisar do modelo (ver ort.ts).
        ortSelfTest: () => import("./lib/ort").then((m) => m.ortSelfTest()),
        // O ORT cru, pra ponte poder montar uma sessão NA THREAD PRINCIPAL e
        // reproduzir o caminho da v0.9.0. É assim que a v0.10.0 prova as duas
        // coisas de uma vez, no mesmo documento e com a mesma imagem: que o
        // resultado do worker é byte a byte igual ao de antes, e quanto a
        // thread principal ficava parada quando a inferência rodava nela.
        ort: () => import("./lib/ort"),
        // Fatia ⑤: a prova de GUI do "Remover objeto" precisa disparar o
        // fluxo sem clicar no modal (o download de 208 MB é o do disco).
        removeobj: () => import("./lib/removeobj"),
        inpaint: () => import("./lib/inpaint"),
        // v0.10.0: a inferência mora num worker. A ponte expõe o dono dele
        // pra que a prova de "a UI não congela" possa ser MEDIDA daqui —
        // dispara `runAi`, conta quadros na thread principal enquanto roda,
        // e chama `cancelAi` pra provar que o Cancelar interrompe mesmo.
        aiworker: () => import("./lib/aiworker"),
        bgremove: () => import("./lib/bgremove"),
      };
    },
  );
}

// Remonta a árvore ao trocar de idioma (todo t() é reavaliado no novo locale).
function Root() {
  const locale = useLocale();
  return <App key={locale} />;
}

// Root REUSADO via globalThis: se o HMR re-executar este entry sem full
// reload, um segundo createRoot no mesmo container deixaria DUAS árvores de
// módulos vivas (a UI velha pintando num registro de camadas e a ponte nova
// lendo outro — lição paga na prova de GUI do v0.1). Reusar o root faz o
// re-exec virar um render normal na árvore nova.
const g = globalThis as unknown as { __lpRoot?: ReactDOM.Root };
g.__lpRoot ??= ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
g.__lpRoot.render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
