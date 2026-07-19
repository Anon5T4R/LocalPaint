/** Bootstrap do onnxruntime-web — UM lugar só pros macetes de WASM.
 *
 *  Nasceu na fatia ⑤: com dois modelos (isnet do bgremove.ts e LaMa do
 *  removeobj.ts) as MESMAS três linhas de configuração viveriam em dois
 *  arquivos, e as duas cópias divergindo é exatamente o bug que a v0.5.0
 *  pagou caro. Quem precisa do ORT importa `ort` daqui.
 *
 *  As três decisões, com o porquê:
 *
 *  1. O subpath `/wasm` importa o bundle SÓ-CPU. O entry padrão do 1.27 traz o
 *     backend webgpu (JSEP) e em runtime pede `ort-wasm-simd-threaded.jsep.mjs`
 *     — que não embarcamos — morrendo com "no available backend found" NO APP
 *     INSTALADO (em dev nada quebra; bug pego no teste real da v0.5.0).
 *  2. Os DOIS arquivos do runtime entram pelo pipeline do vite (`?url`): em dev
 *     viram URL servida como módulo de verdade, no build viram assets emitidos.
 *     O caminho antigo (cópia em `public/ort`) NÃO funciona — o vite não deixa
 *     importar módulo de `public/`, o wrapper devolve uma STRING e o ORT morre
 *     com o mesmo "no available backend found".
 *  3. `numThreads = 1` porque a build multithread exige COOP/COEP que não
 *     setamos (spike próprio no backlog — acelera isnet e LaMa de uma vez).
 */

import * as ort from "onnxruntime-web/wasm";
import ortMjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";

ort.env.wasm.wasmPaths = { mjs: ortMjsUrl, wasm: ortWasmUrl };
ort.env.wasm.numThreads = 1;

export { ort };

/** Selfteste do backend (dev/prova): tenta criar uma sessão com bytes de lixo.
 *  Backend SAUDÁVEL carrega o runtime e falha no PARSE DO MODELO; backend
 *  quebrado falha antes, com "no available backend found" — que foi exatamente
 *  o bug da v0.5.0 no app instalado. Exercitar > listar. */
export async function ortSelfTest(): Promise<string> {
  try {
    await ort.InferenceSession.create(new Uint8Array([1, 2, 3, 4]));
    return "impossível: lixo virou modelo";
  } catch (e) {
    return String(e instanceof Error ? e.message : e);
  }
}
