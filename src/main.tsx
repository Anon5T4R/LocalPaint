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
  void Promise.all([import("./state/doc"), import("./state/tools"), import("./lib/layers")]).then(
    ([d, tl, ly]) => {
      (window as unknown as Record<string, unknown>).__lp = {
        doc: d.useDoc,
        tools: tl.useTools,
        layers: ly,
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
