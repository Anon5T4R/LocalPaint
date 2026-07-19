/** Protocolo entre o worker de IA (`ai.worker.ts`) e o dono dele
 *  (`aiworker.ts`). Módulo separado, e SEM imports de runtime, pela mesma
 *  razão do `segtypes.ts` do LocalRecord: o worker entra por
 *  `new Worker(new URL(...))` e qualquer coisa que ele importe vira chunk
 *  dele. Tipo compartilhado num arquivo com `import` de React ou de Tauri
 *  arrastaria meio app pro bundle do worker.
 *
 *  Tudo aqui é `interface`/`type` (apagado na compilação) ou constante
 *  numérica — nada que exista em runtime dos dois lados ao mesmo tempo.
 */

/** Qual modelo o pedido precisa. Não é "qual worker": é UM worker só, que
 *  troca de sessão conforme a tarefa (ver o cabeçalho do `ai.worker.ts`). */
export type AiTask = "lama" | "isnet";

/** Em que ponto o pedido está — o que o modal mostra pro usuário.
 *  - `loading`: buscando os bytes do modelo no disco e montando a sessão
 *    (~8–10 s pro LaMa: são 208 MB parseados pelo wasm). Só na primeira vez
 *    de cada tarefa.
 *  - `running`: `session.run`, o pedaço de ~20 s.
 *  O download do modelo pela rede NÃO está aqui: ele acontece antes, no Rust,
 *  e cada modal já tem a própria fase `downloading` com barra de progresso. */
export type AiPhase = "loading" | "running";

/** Pedido do "Remover objeto".
 *
 *  Repare no que atravessa a fronteira: os PIXELS DO RECORTE em resolução
 *  nativa, não os tensores 512² já prontos. Toda a matemática de
 *  `inpaint.ts` (reamostragem pra 512, tensores, volta, colagem) roda DENTRO
 *  do worker. É de graça — as funções são puras e determinísticas, então o
 *  resultado é bit a bit o mesmo — e tira da thread principal também os
 *  ~100–200 ms de reamostragem de uma janela grande (numa foto de 4032 px a
 *  janela passa de 1500² e o `areaAxis` percorre milhões de pixels). O
 *  congelamento de 20 s era o crime; esses 200 ms eram o cúmplice. */
export interface AiLamaJob {
  task: "lama";
  /** Recorte da janela, RGBA, `w * h * 4`. É TRANSFERIDO (o buffer é
   *  destacado do lado de cá) e volta pelo mesmo caminho já com o buraco
   *  preenchido — nenhuma cópia de megabytes em nenhum sentido. */
  rgba: Uint8ClampedArray;
  /** Máscara do buraco em resolução NATIVA, 0/1, `w * h`. A colagem final
   *  usa esta, nunca a de 512 reamostrada de volta (ver `inpaint.ts`). */
  mask: Uint8Array;
  w: number;
  h: number;
}

/** Pedido da "Remover fundo".
 *
 *  Aqui a fronteira cai noutro lugar: o isnet quer 1024² e quem reamostra é
 *  o `drawImage` do canvas, que não existe no worker (OffscreenCanvas
 *  resolveria, mas trocar o reamostrador trocaria os pixels — e o gate desta
 *  fatia é justamente "o resultado não mudou"). Então a thread principal
 *  entrega os 1024² já prontos e recebe o alpha de volta; o que sobra pra ela
 *  são dois `drawImage`, que são rápidos e não é onde estava o problema. */
export interface AiIsnetJob {
  task: "isnet";
  /** Imagem já reamostrada pra 1024×1024, RGBA. Transferida. */
  rgba: Uint8ClampedArray;
}

export type AiJob = AiLamaJob | AiIsnetJob;

/** Resposta do LaMa: o MESMO buffer que foi mandado, com o buraco preenchido
 *  (o worker muta e devolve). */
export interface AiLamaResult {
  task: "lama";
  rgba: Uint8ClampedArray;
  inferenceMs: number;
}

/** Resposta do isnet: o mapa de alpha 0–255 e as dimensões que o modelo
 *  devolveu (lidas do tensor, não presumidas — o grafo pode sair menor). */
export interface AiIsnetResult {
  task: "isnet";
  alpha: Uint8ClampedArray;
  w: number;
  h: number;
  inferenceMs: number;
}

export type AiResult = AiLamaResult | AiIsnetResult;

/** Mensagens que o dono manda pro worker. */
export type AiWorkerIn =
  | { type: "run"; id: number; job: AiJob }
  /** Os bytes do modelo, em resposta a um `need-model`. Quem lê o disco é a
   *  thread principal, de propósito: `convertFileSrc` depende do
   *  `__TAURI_INTERNALS__`, que só é injetado na janela — não no worker.
   *  Manter todo o Tauri de um lado só da fronteira é o que deixa o worker
   *  testável fora do app e imune a mudança de asset protocol. */
  | { type: "model"; id: number; bytes: ArrayBuffer };

/** Mensagens que o worker manda de volta. */
export type AiWorkerOut =
  /** "Não tenho a sessão desta tarefa; me manda os bytes." O worker é a
   *  AUTORIDADE sobre o que está carregado — se o dono guardasse esse estado
   *  em paralelo, os dois poderiam divergir (e divergir aqui significa ou
   *  buscar 208 MB à toa, ou rodar contra sessão que não existe). */
  | { type: "need-model"; id: number }
  | { type: "phase"; id: number; phase: AiPhase }
  | { type: "done"; id: number; result: AiResult }
  | { type: "failed"; id: number; error: string };
