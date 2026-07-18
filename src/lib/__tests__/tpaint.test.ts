import { describe, expect, it } from "vitest";
import JSZip from "jszip";

import { parseTpaint, serializeTpaint, type TpaintDoc } from "../tpaint";

/** O codec NÃO decodifica PNG (isso é papel do io.ts, que tem DOM) — então
 *  qualquer bytes servem de "PNG" no teste. */
const png = (seed: number) => new Uint8Array([137, 80, 78, 71, seed, seed + 1, seed + 2]);

function doc(): TpaintDoc {
  return {
    meta: { width: 320, height: 200 },
    layers: [
      {
        meta: { id: "L1", name: "Fundo", visible: true, opacity: 1, blend: "normal" },
        png: png(10),
      },
      {
        meta: { id: "L2", name: "Rabisco", visible: false, opacity: 0.5, blend: "multiply" },
        png: png(60),
      },
    ],
  };
}

describe("tpaint", () => {
  it("roundtrip preserva meta, ordem e bytes das camadas", async () => {
    const bytes = await serializeTpaint(doc());
    const back = await parseTpaint(bytes);
    expect(back.meta).toEqual({ width: 320, height: 200 });
    expect(back.layers.map((l) => l.meta)).toEqual(doc().layers.map((l) => l.meta));
    expect([...back.layers[0].png]).toEqual([...png(10)]);
    expect([...back.layers[1].png]).toEqual([...png(60)]);
  });

  it("é um zip aberto por qualquer descompactador (apólice de seguro)", async () => {
    const bytes = await serializeTpaint(doc());
    const zip = await JSZip.loadAsync(bytes);
    expect(zip.file("doc.json")).toBeTruthy();
    expect(zip.file("layers/000-L1.png")).toBeTruthy();
    expect(zip.file("layers/001-L2.png")).toBeTruthy();
  });

  it("não-zip → erro nomeado", async () => {
    await expect(parseTpaint(new Uint8Array([1, 2, 3]))).rejects.toThrow(/zip/);
  });

  it("zip sem doc.json → erro nomeado", async () => {
    const zip = new JSZip();
    zip.file("outra-coisa.txt", "oi");
    const bytes = await zip.generateAsync({ type: "uint8array" });
    await expect(parseTpaint(bytes)).rejects.toThrow(/doc\.json/);
  });

  it("versão futura → erro que NOMEIA a versão", async () => {
    const zip = new JSZip();
    zip.file("doc.json", JSON.stringify({ version: 9, width: 10, height: 10, layers: [] }));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    await expect(parseTpaint(bytes)).rejects.toThrow(/9/);
  });

  it("camada sem arquivo no zip → erro que NOMEIA a camada", async () => {
    const zip = new JSZip();
    zip.file(
      "doc.json",
      JSON.stringify({
        version: 1,
        width: 10,
        height: 10,
        layers: [{ id: "L1", name: "Perdida", visible: true, opacity: 1, blend: "normal", file: "layers/x.png" }],
      }),
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    await expect(parseTpaint(bytes)).rejects.toThrow(/Perdida/);
  });

  it("blend desconhecido degrada pra normal (arquivo do futuro abre)", async () => {
    const zip = new JSZip();
    zip.file(
      "doc.json",
      JSON.stringify({
        version: 1,
        width: 10,
        height: 10,
        layers: [{ id: "L1", name: "A", visible: true, opacity: 1, blend: "hologram-3000", file: "layers/a.png" }],
      }),
    );
    zip.file("layers/a.png", png(1));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const back = await parseTpaint(bytes);
    expect(back.layers[0].meta.blend).toBe("normal");
  });

  it("dimensões absurdas são grampeadas", async () => {
    const zip = new JSZip();
    zip.file(
      "doc.json",
      JSON.stringify({
        version: 1,
        width: 999999,
        height: 0,
        layers: [{ id: "L1", name: "A", visible: true, opacity: 1, blend: "normal", file: "layers/a.png" }],
      }),
    );
    zip.file("layers/a.png", png(1));
    const back = await parseTpaint(await zip.generateAsync({ type: "uint8array" }));
    expect(back.meta.width).toBe(8192);
    expect(back.meta.height).toBe(1);
  });
});
