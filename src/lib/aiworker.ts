/** Dono do worker de IA: sobe, alimenta, cancela e derruba.
 *
 *  Toda a fronteira com o Tauri mora AQUI, não no worker. `convertFileSrc`
 *  depende do `__TAURI_INTERNALS__`, que o runtime injeta na JANELA e não no
 *  worker; ler o modelo do lado de cá e mandar os BYTES (transferidos, sem
 *  cópia) deixa o worker ignorante de Tauri — o que o torna dirigível fora do
 *  app e imune a mudança de asset protocol. É também o desenho do LocalRecord
 *  (lá o worker recebe uma URL; aqui recebe bytes, porque o asset protocol
 *  tem escopo e o worker não é a janela).
 *
 *  ── Um pedido por vez ──
 *
 *  Diferente do `segmenter.ts` do LocalRecord — que descarta quadro quando o
 *  worker está ocupado porque a fonte é contínua a 30 fps — aqui a operação é
 *  ÚNICA e LONGA. Não há o que descartar: um segundo pedido durante o
 *  primeiro é um bug de UI (os dois modais são exclusivos), então ele falha
 *  alto em vez de enfileirar calado.
 *
 *  ── O que "Cancelar" significa ──
 *
 *  `terminate()`. Não é escolha estilística: o `session.run` do
 *  onnxruntime-web não cede a thread do worker, então nenhuma flag chegaria a
 *  ser lida antes de a inferência acabar — um cancelamento cooperativo seria
 *  um botão que só mente por 20 segundos. Matar o worker interrompe de
 *  verdade, no meio da instrução do wasm.
 *
 *  O PREÇO, declarado: a sessão morre junto, e a próxima inferência paga o
 *  carregamento outra vez (~10 s pro LaMa, ~5 s pro isnet). É a troca certa —
 *  quem cancela quer sair AGORA, e o custo cai na próxima vez (que pode nem
 *  vir), não na que está incomodando.
 */

import { convertFileSrc } from "@tauri-apps/api/core";

import type { AiJob, AiPhase, AiResult, AiWorkerOut } from "./aitypes";

/** Sentinela reusada: os dois modais já tratam "cancelado" como escolha do
 *  usuário (fecha calado, sem toast de erro) porque é o que o Rust devolve ao
 *  abortar o download. Cancelar a inferência é a mesma intenção, então usa a
 *  mesma palavra — um caminho de saída, não dois. */
export const CANCELLED = "cancelado";

interface Inflight {
  id: number;
  path: string;
  resolve: (r: AiResult) => void;
  reject: (e: Error) => void;
  onPhase?: (p: AiPhase) => void;
}

let worker: Worker | null = null;
let inflight: Inflight | null = null;
let seq = 0;

/** Cria o worker. `type: module` + `new URL` relativa é o que o vite
 *  reconhece pra emitir o worker como chunk próprio no build (e servir em
 *  dev); string literal solta viraria 404 no instalador. */
function spawn(): Worker {
  const w = new Worker(new URL("./ai.worker.ts", import.meta.url), { type: "module" });

  w.onmessage = (e: MessageEvent) => {
    const msg = e.data as AiWorkerOut;
    const job = inflight;
    // Mensagem de um pedido que já morreu (cancelado). Ignora: agir nela
    // resolveria uma promessa que ninguém espera mais.
    if (!job || job.id !== msg.id) return;

    if (msg.type === "phase") {
      job.onPhase?.(msg.phase);
      return;
    }

    if (msg.type === "need-model") {
      job.onPhase?.("loading");
      void (async () => {
        try {
          const res = await fetch(convertFileSrc(job.path));
          // Lição do LocalVideo: o asset protocol responde ERRO (não o
          // arquivo) pra caminho fora do escopo. Sem este cheque o corpo do
          // erro — uma página — iria parar no onnxruntime e o diagnóstico
          // viraria adivinhação.
          if (!res.ok) throw new Error(`asset ${res.status}`);
          const bytes = await res.arrayBuffer();
          // O pedido pode ter sido cancelado durante o `await` dos 208 MB.
          if (inflight?.id !== job.id || !worker) return;
          worker.postMessage({ type: "model", id: job.id, bytes }, [bytes]);
        } catch (err) {
          if (inflight?.id !== job.id) return;
          settle(job, null, err instanceof Error ? err : new Error(String(err)));
        }
      })();
      return;
    }

    if (msg.type === "done") {
      settle(job, msg.result, null);
      return;
    }

    settle(job, null, new Error(msg.error));
  };

  // Worker que morre sozinho (OOM parseando 208 MB é o caso realista) não
  // pode deixar o modal girando pra sempre esperando um resultado que não vem.
  w.onerror = () => {
    if (inflight) settle(inflight, null, new Error("worker morreu"));
    // A sessão foi junto: o próximo pedido tem que subir um worker novo.
    worker = null;
  };

  return w;
}

function settle(job: Inflight, result: AiResult | null, err: Error | null): void {
  if (inflight?.id !== job.id) return;
  inflight = null;
  if (result) job.resolve(result);
  else job.reject(err ?? new Error("falha desconhecida"));
}

/** Roda um pedido no worker. `path` é o caminho do modelo NO DISCO (o que o
 *  `model_path` do Rust devolve) — quem baixa é o modal, antes.
 *
 *  Os buffers do `job` são TRANSFERIDOS: depois desta chamada eles estão
 *  destacados (byteLength 0) do lado de cá. Quem chama tem que passar cópias
 *  descartáveis — são megabytes, e copiá-los por precaução seria pagar duas
 *  vezes justamente no caminho que estamos otimizando. */
export function runAi(job: AiJob, path: string, onPhase?: (p: AiPhase) => void): Promise<AiResult> {
  if (inflight) return Promise.reject(new Error("inferência já em andamento"));
  worker ??= spawn();
  const id = ++seq;

  return new Promise<AiResult>((resolve, reject) => {
    inflight = { id, path, resolve, reject, onPhase };
    // Transferir o que é grande. `job.mask` só existe no LaMa; o `filter`
    // evita mandar `undefined` na lista (o que o postMessage recusa).
    const transfer: Transferable[] =
      job.task === "lama" ? [job.rgba.buffer, job.mask.buffer] : [job.rgba.buffer];
    worker!.postMessage({ type: "run", id, job }, transfer);
  });
}

/** Interrompe a inferência em curso, de verdade. Sem pedido no ar é no-op.
 *  A promessa pendente é rejeitada com `CANCELLED`, que os modais já sabem
 *  tratar como "fecha calado". */
export function cancelAi(): void {
  const job = inflight;
  worker?.terminate();
  // Zerado ANTES de rejeitar: o `settle` do `onerror` que o terminate possa
  // disparar não pode achar que ainda há um pedido vivo.
  worker = null;
  inflight = null;
  job?.reject(new Error(CANCELLED));
}

/** Se há inferência rodando agora. O modal usa pra decidir se mostra o
 *  Cancelar (e pra não fechar no clique fora com trabalho no ar). */
export function aiBusy(): boolean {
  return inflight !== null;
}
