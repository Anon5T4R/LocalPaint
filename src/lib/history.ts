/** Undo/redo com ORÇAMENTO DE MEMÓRIA, não contagem de passos.
 *
 *  Snapshot de pintura é pesado (um dirty-rect de 2000×1500 são 12 MB); "50
 *  passos" podia ser 600 MB ou 600 KB dependendo do traço. Aqui cada entrada
 *  declara seus bytes e o stack expulsa as MAIS ANTIGAS quando o total passa
 *  do teto — o usuário perde o undo de uma hora atrás, nunca o de agora.
 *
 *  Genérico e puro: entradas são {undo, redo, bytes, label}. Quem captura
 *  pixels é o chamador (CanvasStage/store); aqui só mora a disciplina do
 *  stack. Testável em Node com entradas fake.
 */

export interface HistoryEntry {
  /** Desfaz o efeito (aplica o estado "antes"). */
  undo: () => void;
  /** Reaplica o efeito (estado "depois"). */
  redo: () => void;
  /** Custo aproximado em bytes (0 pra ops estruturais leves). */
  bytes: number;
  /** Pra depuração/telemetria local; não aparece na UI na v0.1. */
  label: string;
}

export interface History {
  past: HistoryEntry[];
  future: HistoryEntry[];
  bytes: number;
  budget: number;
}

/** 256 MB: cabe um bom passeio de undo em doc grande sem flertar com OOM no
 *  hardware alvo (17.8 GB de RAM, mas o webview é um processo só). */
export const DEFAULT_BUDGET = 256 * 1024 * 1024;

export function newHistory(budget = DEFAULT_BUDGET): History {
  return { past: [], future: [], bytes: 0, budget };
}

/** Empurra uma entrada JÁ APLICADA (o padrão: o gesto pinta direto no canvas;
 *  o push registra como voltar/repetir). Limpa o redo — futuro alternativo
 *  morre quando se age, como em todo editor. */
export function push(h: History, e: HistoryEntry): History {
  let past = [...h.past, e];
  let bytes = h.bytes + e.bytes;
  // Expulsa do FUNDO até caber. A entrada nova nunca é expulsa — mesmo que
  // sozinha estoure o teto, ela fica (melhor 1 undo caro que zero).
  while (bytes > h.budget && past.length > 1) {
    bytes -= past[0].bytes;
    past = past.slice(1);
  }
  return { ...h, past, future: [], bytes };
}

export function canUndo(h: History): boolean {
  return h.past.length > 0;
}

export function canRedo(h: History): boolean {
  return h.future.length > 0;
}

export function undo(h: History): History {
  const e = h.past[h.past.length - 1];
  if (!e) return h;
  e.undo();
  return { ...h, past: h.past.slice(0, -1), future: [...h.future, e], bytes: h.bytes - e.bytes };
}

export function redo(h: History): History {
  const e = h.future[h.future.length - 1];
  if (!e) return h;
  e.redo();
  // Redo devolve os bytes ao stack de past.
  return { ...h, past: [...h.past, e], future: h.future.slice(0, -1), bytes: h.bytes + e.bytes };
}
