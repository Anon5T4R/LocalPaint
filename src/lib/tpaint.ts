/** Formato nativo `.tpaint` — zip com `doc.json` + uma PNG por camada.
 *
 *  Zip no WEBVIEW via JSZip (regra da suíte; o Rust só move bytes). PNG por
 *  camada e não um blob proprietário: se o LocalPaint sumir do mundo, qualquer
 *  descompactador entrega as camadas abertas em qualquer visualizador — o
 *  formato é a apólice de seguro do usuário, não uma prisão.
 *
 *  Este módulo é PURO: entra/sai `Uint8Array` (os bytes PNG de cada camada);
 *  quem rasteriza canvas→PNG e PNG→canvas é o chamador (io.ts, que precisa de
 *  DOM). Assim o codec roda em Node no vitest com PNGs fabricados.
 */

import JSZip from "jszip";

import { BLEND_MODES, clampDim, type BlendMode, type DocMeta, type LayerMeta } from "./model";

export interface TpaintLayer {
  meta: LayerMeta;
  /** Bytes de um PNG com o conteúdo da camada (tamanho do doc). */
  png: Uint8Array;
}

export interface TpaintDoc {
  meta: DocMeta;
  /** De baixo pra cima — a MESMA ordem do modelo em memória. */
  layers: TpaintLayer[];
}

interface DocJson {
  version: 1;
  app: string;
  width: number;
  height: number;
  layers: {
    id: string;
    name: string;
    visible: boolean;
    opacity: number;
    blend: string;
    file: string;
  }[];
}

export async function serializeTpaint(doc: TpaintDoc): Promise<Uint8Array> {
  const zip = new JSZip();
  const json: DocJson = {
    version: 1,
    app: "LocalPaint",
    width: doc.meta.width,
    height: doc.meta.height,
    layers: doc.layers.map((l, i) => ({
      id: l.meta.id,
      name: l.meta.name,
      visible: l.meta.visible,
      opacity: l.meta.opacity,
      blend: l.meta.blend,
      // Índice no nome = ordem legível pra quem descompactar na mão.
      file: `layers/${String(i).padStart(3, "0")}-${l.meta.id}.png`,
    })),
  };
  zip.file("doc.json", JSON.stringify(json, null, 2));
  doc.layers.forEach((l, i) => {
    zip.file(json.layers[i].file, l.png);
  });
  // DEFLATE nível 6: PNG já vem comprimido, mas o doc.json e camadas muito
  // vazias (PNG de área transparente) ainda encolhem de graça.
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

/** Lança com mensagem legível quando o arquivo não é um .tpaint válido — a
 *  mensagem sobe pro toast, então ela nomeia O QUE está errado. */
export async function parseTpaint(bytes: Uint8Array): Promise<TpaintDoc> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error("não é um zip — arquivo corrompido ou não é .tpaint");
  }
  const docFile = zip.file("doc.json");
  if (!docFile) throw new Error("sem doc.json — não é um .tpaint");

  let json: DocJson;
  try {
    json = JSON.parse(await docFile.async("string")) as DocJson;
  } catch {
    throw new Error("doc.json ilegível");
  }
  if (json.version !== 1) {
    throw new Error(`versão ${String(json.version)} não suportada (este LocalPaint lê a 1)`);
  }

  const width = clampDim(json.width);
  const height = clampDim(json.height);
  if (!Array.isArray(json.layers) || json.layers.length === 0) {
    throw new Error("documento sem camadas");
  }

  const layers: TpaintLayer[] = [];
  for (const l of json.layers) {
    const f = zip.file(l.file);
    if (!f) throw new Error(`camada "${l.name}" sem arquivo (${l.file})`);
    const png = await f.async("uint8array");
    const blend: BlendMode = (BLEND_MODES as readonly string[]).includes(l.blend)
      ? (l.blend as BlendMode)
      : "normal";
    layers.push({
      meta: {
        id: String(l.id),
        name: String(l.name || "Camada"),
        visible: l.visible !== false,
        opacity: typeof l.opacity === "number" ? Math.min(1, Math.max(0, l.opacity)) : 1,
        blend,
      },
      png,
    });
  }

  return { meta: { width, height }, layers };
}
