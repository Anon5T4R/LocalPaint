/** Worker de IA — o ÚNICO lugar do app que roda `session.run`.
 *
 *  ── O bug que ele mata ──
 *
 *  Medido na v0.9.0: o "Remover objeto" leva ~20 s de inferência (mais ~10 s
 *  na primeira vez, parseando os 208 MB do LaMa). O `session.run` do
 *  onnxruntime-web é `async` na ASSINATURA mas SÍNCRONO no wasm: ele não
 *  cede a thread. Resultado — a janela congelava por 20 segundos: spinner
 *  parado, botão sem resposta, título "não está respondendo". Congelamento
 *  longo é indistinguível de travamento, e o usuário podia matar o processo
 *  no meio. A remoção de fundo tinha o mesmo defeito, só que mais curto.
 *
 *  ── Um worker, UMA sessão por vez ──
 *
 *  São dois modelos (LaMa 208 MB, isnet 170 MB) e a escolha foi um worker só
 *  que TROCA de sessão, não dois workers com uma sessão viva cada. Por quê:
 *
 *  1. Memória. O LaMa sozinho custou ~600 MB de RSS medidos (os pesos, mais
 *     o arena de tensores do wasm). Somar o isnet levaria o processo pra
 *     perto de 1 GB sem que nada peça isso — o heap do wasm32 tem teto de
 *     4 GB e o webview inteiro divide esse teto com o canvas do documento,
 *     que numa foto de 4032² já é dezenas de MB por camada.
 *  2. As duas tarefas NUNCA são simultâneas: cada uma é um modal, e modal é
 *     exclusivo. Duas sessões vivas seria pagar memória por um paralelismo
 *     que a UI proíbe.
 *  3. O caso que importa pra velocidade — clicar "remover objeto" várias
 *     vezes seguidas — continua batendo no cache: a sessão só é descartada
 *     quando a TAREFA muda. Quem alterna fundo/objeto paga ~10 s de recarga
 *     na troca; quem repete a mesma tarefa não paga nada. Foi essa assimetria
 *     que decidiu: o caso comum é repetir, não alternar.
 *
 *  O protocolo é deliberadamente burro (um pedido → um resultado) e quem
 *  garante que só há um pedido no ar é o dono, em `aiworker.ts`.
 *
 *  ── Cancelar ──
 *
 *  Não existe cancelamento cooperativo: o `session.run` não cede a thread, e
 *  por isso nenhuma flag lida aqui dentro seria vista antes de ele terminar.
 *  O cancelamento REAL é o dono chamar `terminate()` — mata o worker no meio
 *  da instrução do wasm. Abrupto, mas imediato e honesto. O custo está
 *  documentado em `aiworker.ts`: a sessão morre junto e a próxima vez paga
 *  o carregamento de novo.
 */

// O subpath `/wasm` (bundle só-CPU) e o runtime por `?url` moram no `ort.ts`
// — o worker REUSA aquele bootstrap em vez de repetir as três linhas. Duas
// cópias divergindo dessa configuração é literalmente o bug da v0.5.0 ("no
// available backend found" no app instalado, funcionando em dev), e o `ort.ts`
// nasceu na v0.9.0 pra que ele não pudesse voltar. Importar daqui também é o
// que faz o vite emitir os assets do wasm como dependência DO CHUNK DO
// WORKER, com os caminhos certos pro bundle de produção.
import { ort } from "./ort";

import type { AiIsnetJob, AiLamaJob, AiTask, AiWorkerIn, AiWorkerOut } from "./aitypes";
import {
  blendHole,
  fromLamaOutput,
  INPAINT_DIM,
  resample,
  resampleMaskMax,
  toLamaImage,
  toLamaMask,
} from "./inpaint";
import { saliencyToAlpha, toIsnetInput } from "./matte";

/** Resolução de treino do isnet (a mesma constante do `bgremove.ts` — a
 *  entrada já chega reamostrada pra cá pelo canvas da thread principal). */
const ISNET_DIM = 1024;

/** A sessão viva, e de QUAL tarefa ela é. Os dois andam juntos sempre: é
 *  esse par que responde ao `need-model` sem precisar perguntar a ninguém. */
let session: ort.InferenceSession | null = null;
let loaded: AiTask | null = null;

/** O pedido que chegou e ainda não rodou (esperando os bytes do modelo).
 *  Cabe UM: o dono serializa, então isto nunca é uma fila disfarçada. */
let pending: { id: number; job: AiLamaJob | AiIsnetJob } | null = null;

const post = (msg: AiWorkerOut, transfer?: Transferable[]) =>
  (self as unknown as Worker).postMessage(msg, transfer ?? []);

/** Descarta a sessão atual ANTES de criar a próxima.
 *
 *  A ordem importa e é o ponto inteiro do desenho: criar a nova primeiro
 *  faria os dois modelos coexistirem no heap por alguns segundos — o pico
 *  que estamos justamente evitando. `release()` devolve o arena do wasm; sem
 *  ele o GC do JS não tem como saber que aqueles centenas de MB acabaram. */
async function dropSession(): Promise<void> {
  const old = session;
  session = null;
  loaded = null;
  if (old) {
    try {
      await old.release();
    } catch {
      // Sessão que não solta não é motivo pra derrubar o pedido novo: o
      // pior caso é memória segurada até o worker morrer, e ele morre no
      // `terminate()` de qualquer cancelamento ou fechamento.
    }
  }
}

async function run(id: number, job: AiLamaJob | AiIsnetJob): Promise<void> {
  if (!session) {
    post({ type: "failed", id, error: "sessão ausente" });
    return;
  }
  post({ type: "phase", id, phase: "running" });

  if (job.task === "lama") {
    const { rgba, mask, w, h } = job;
    // Daqui pra baixo é o MESMO código que rodava no `removeobj.ts` da
    // v0.9.0, na mesma ordem e com as mesmas funções puras — mudou o fio
    // que executa, não a aritmética. É por isso que o resultado é bit a bit
    // idêntico, e não "parecido".
    const img512 = resample(rgba, w, h, INPAINT_DIM, INPAINT_DIM);
    const mask512 = resampleMaskMax(mask, w, h, INPAINT_DIM, INPAINT_DIM);

    const t0 = performance.now();
    const out = await session.run({
      image: new ort.Tensor("float32", toLamaImage(img512, INPAINT_DIM, INPAINT_DIM), [1, 3, INPAINT_DIM, INPAINT_DIM]),
      mask: new ort.Tensor("float32", toLamaMask(mask512), [1, 1, INPAINT_DIM, INPAINT_DIM]),
    });
    const inferenceMs = performance.now() - t0;

    const filled512 = fromLamaOutput(out.output.data as Float32Array, INPAINT_DIM, INPAINT_DIM);
    const filled = resample(filled512, INPAINT_DIM, INPAINT_DIM, w, h);
    // Muta o buffer que veio de lá e devolve o MESMO — vai e volta sem cópia.
    blendHole(rgba, filled, mask);

    post({ type: "done", id, result: { task: "lama", rgba, inferenceMs } }, [rgba.buffer]);
    return;
  }

  const { rgba } = job as AiIsnetJob;
  const t0 = performance.now();
  const results = await session.run({
    [session.inputNames[0]]: new ort.Tensor("float32", toIsnetInput(rgba, ISNET_DIM, ISNET_DIM), [1, 3, ISNET_DIM, ISNET_DIM]),
  });
  const inferenceMs = performance.now() - t0;

  const out = results[session.outputNames[0]];
  const dims = out.dims;
  // Dimensões LIDAS do tensor, não presumidas: o grafo pode devolver menor
  // que a entrada, e presumir 1024 aqui daria uma máscara torta em vez de um
  // erro (comportamento herdado do `bgremove.ts`, preservado de propósito).
  const h = dims[dims.length - 2] ?? ISNET_DIM;
  const w = dims[dims.length - 1] ?? ISNET_DIM;
  const alpha = saliencyToAlpha(out.data as Float32Array);

  post({ type: "done", id, result: { task: "isnet", alpha, w, h, inferenceMs } }, [alpha.buffer]);
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as AiWorkerIn;

  if (msg.type === "run") {
    pending = { id: msg.id, job: msg.job };
    // Cache batendo: roda direto, sem tocar no disco. É o caminho do
    // segundo clique seguido — e é o que faz "uma sessão por vez" custar
    // barato na prática.
    if (loaded === msg.job.task && session) {
      try {
        await run(msg.id, msg.job);
      } catch (err) {
        post({ type: "failed", id: msg.id, error: String(err) });
      }
      pending = null;
      return;
    }
    post({ type: "need-model", id: msg.id });
    return;
  }

  if (msg.type === "model") {
    const job = pending;
    // Resposta a um pedido que já não existe (cancelado e recriado): ignora.
    // Sem este cheque, os bytes virariam uma sessão que ninguém usaria.
    if (!job || job.id !== msg.id) return;
    try {
      post({ type: "phase", id: msg.id, phase: "loading" });
      await dropSession();
      session = await ort.InferenceSession.create(new Uint8Array(msg.bytes), { executionProviders: ["wasm"] });
      loaded = job.job.task;
      await run(job.id, job.job);
    } catch (err) {
      // Falha limpa a sessão: a próxima tentativa recomeça do zero em vez de
      // herdar uma sessão meio-morta (a mesma regra do cache da v0.9.0).
      await dropSession();
      post({ type: "failed", id: msg.id, error: String(err) });
    }
    pending = null;
  }
};
