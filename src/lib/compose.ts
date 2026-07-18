/** Composição das camadas — usada pelo palco (tela) e pelo export (arquivo).
 *  Uma função só pros dois: o que o usuário vê é o que sai no PNG, por
 *  construção e não por sorte. */

import { getLayerCanvas } from "./layers";
import { blendToComposite, type LayerMeta } from "./model";

/** Desenha as camadas visíveis, de baixo pra cima, no contexto dado. O caller
 *  decide fundo (checkerboard na tela; nada no export — PNG sai transparente
 *  onde ninguém pintou). */
export function compositeInto(ctx: CanvasRenderingContext2D, layers: LayerMeta[]) {
  for (const l of layers) {
    if (!l.visible || l.opacity <= 0) continue;
    const c = getLayerCanvas(l.id);
    if (!c) continue;
    ctx.globalAlpha = l.opacity;
    ctx.globalCompositeOperation = blendToComposite(l.blend);
    ctx.drawImage(c, 0, 0);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

/** Documento achatado num canvas novo (export png/jpg/webp).
 *  `background` pinta por baixo — JPG não tem alpha; sem fundo, o que era
 *  transparente sairia PRETO no encoder, que é o clássico susto do export. */
export function flatten(w: number, h: number, layers: LayerMeta[], background?: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("canvas 2d indisponível");
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
  }
  compositeInto(ctx, layers);
  return c;
}
