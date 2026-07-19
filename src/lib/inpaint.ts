/** Matemática pura do "Remover objeto" (inpainting com LaMa) — fatia ⑤.
 *
 *  Tudo aqui é puro (arrays, sem canvas e sem ORT) pela mesma razão do
 *  `mask.ts`: o risco real desta fatia é erro de 1 pixel no recorte/escala/
 *  colagem, e isso se mata com teste em Node, não olhando o resultado.
 *  A orquestração (sessão, camada, undo) mora em `removeobj.ts`.
 *
 *  ── O problema que dita o desenho: o LaMa tem ENTRADA FIXA 512×512 ──
 *
 *  Reduzir a imagem INTEIRA pra 512 é o caminho ingênuo: numa foto de 4000 px
 *  isso joga fora toda a resolução e o resultado volta borrado. O que fazemos:
 *
 *  1. `planInpaint` recorta uma janela ao redor da seleção (já dilatada) com
 *     margem de contexto — o LaMa precisa ver o entorno pra inventar textura
 *     coerente; sem contexto ele preenche com borrão.
 *  2. A janela vai pra 512 (`resample`), roda, e volta ao tamanho nativo.
 *  3. `blendHole` cola respeitando a máscara NATIVA: só os pixels do buraco
 *     mudam. O resto da janela volta byte a byte igual — sujar o entorno com o
 *     ruído do vai-e-volta de escala seria dano gratuito.
 *
 *  O passo 3 usa a máscara em resolução NATIVA de propósito (nunca a de 512
 *  reamostrada de volta): assim a borda do buraco é exatamente a que o usuário
 *  selecionou, sem o meio-pixel que o round-trip de escala introduziria.
 *
 *  Convenção de máscara do LaMa: **1 = BURACO** (a região a remover). É o
 *  OPOSTO do MI-GAN, e trocar não dá erro — dá resultado surreal (repinta tudo
 *  e preserva justamente o objeto). Ver `docs/planos/analises-viabilidade.md`
 *  §4.6b. `toLamaMask` é o único lugar que escreve essa convenção.
 */

import type { Rect } from "./geometry";
import type { MaskSel } from "./mask";

/** Lado da entrada do LaMa. Não é configurável: está assado no grafo do onnx
 *  (`image` [1,3,512,512], `mask` [1,1,512,512], medido no modelo). */
export const INPAINT_DIM = 512;

/** Margem de contexto por lado, como fração do maior lado da seleção. 0,4 =
 *  a janela fica ~1,8× a seleção.
 *
 *  MEDIDO (foto real, gato de 900 px numa 4032×3024, comparando 40% × 15%):
 *  a intuição de que menos margem sairia mais nítido — janela menor, menos
 *  redução pro 512 — está ERRADA. Com 15% a redução caiu de 3,2× pra 2,3× e a
 *  nitidez do miolo não subiu (0,48 contra 0,52 da razão miolo/entorno); o que
 *  mudou foi a emenda, que ficou MAIS visível por falta de entorno.
 *
 *  A razão é que o borrão do preenchimento não vem da nossa redução: vem do
 *  LaMa, que devolve fundo de baixa frequência e não inventa textura fina. Ou
 *  seja, contexto é de graça em nitidez e paga em plausibilidade — por isso a
 *  margem é generosa em vez de econômica. */
export const CONTEXT_RATIO = 0.4;

/** Dilatação da seleção antes do inpaint. Máscara crua encostada no objeto
 *  deixa halo do PRÓPRIO objeto na borda (os pixels de anti-aliasing que a
 *  seleção não pegou) — é a diferença entre "sumiu" e "sumiu quase". */
export const DILATE_PX = 6;

/** Janela a recortar ao redor da seleção (bounds JÁ dilatado), em coordenadas
 *  de doc. Garante conter o bounds inteiro e nunca sair do documento.
 *
 *  A regra tem dois regimes, e o segundo é o que dá qualidade de graça:
 *  - janela MENOR que 512: cresce até 512, porque abaixo disso não há redução
 *    nenhuma (1:1 no modelo) — contexto extra sai sem custo de resolução;
 *  - janela MAIOR que 512: fica no tamanho pedido pelo contexto e paga uma
 *    redução, mas a perda fica contida à janela, não à imagem toda.
 *
 *  O ponto de virada é seleção de ~284 px de lado (1,8 × 284 ≈ 512): abaixo
 *  dele NÃO há reamostragem nenhuma e o preenchimento sai em resolução nativa
 *  — medido em foto real, some sem emenda visível. Acima, o objeto some do
 *  mesmo jeito (sem fantasma) mas a área preenchida fica mais lisa que a
 *  vizinhança e o retângulo dá pra adivinhar. É limite do LaMa em 512, não do
 *  recorte: ver a medição em `CONTEXT_RATIO`.
 *
 *  A janela é quadrada quando o documento deixa (o modelo é 512×512; recorte
 *  quadrado evita distorcer a cena). Em documento muito achatado ela degenera
 *  pra retangular e o resample distorce — geometria preservada mesmo assim,
 *  porque a volta desfaz a mesma distorção. */
export function planInpaint(bounds: Rect, docW: number, docH: number): Rect {
  const side = Math.max(bounds.w, bounds.h);
  const want = Math.max(INPAINT_DIM, Math.ceil(side * (1 + 2 * CONTEXT_RATIO)));
  // `want >= bounds.w` e `docW >= bounds.w` ⇒ `w >= bounds.w`: a contenção do
  // bounds na janela é invariante, não sorte (o teste cobre o caso achatado).
  const w = Math.min(want, docW);
  const h = Math.min(want, docH);
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  const x = Math.min(Math.max(0, Math.round(cx - w / 2)), docW - w);
  const y = Math.min(Math.max(0, Math.round(cy - h / 2)), docH - h);
  return { x, y, w, h };
}

/** Máscara da seleção recortada pra janela (0/1, um byte por pixel da janela).
 *  Fora do bounds da seleção é 0; `sel.mask === null` é o retângulo cheio. */
export function cropMask(sel: MaskSel, crop: Rect): Uint8Array {
  const out = new Uint8Array(crop.w * crop.h);
  const x0 = Math.max(crop.x, sel.bounds.x);
  const y0 = Math.max(crop.y, sel.bounds.y);
  const x1 = Math.min(crop.x + crop.w, sel.bounds.x + sel.bounds.w);
  const y1 = Math.min(crop.y + crop.h, sel.bounds.y + sel.bounds.h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const inside = sel.mask ? sel.mask[(y - sel.bounds.y) * sel.bounds.w + (x - sel.bounds.x)] : 1;
      if (inside) out[(y - crop.y) * crop.w + (x - crop.x)] = 1;
    }
  }
  return out;
}

/** Média de área (box) separável — a redução CORRETA. Bilinear reduzindo
 *  subamostra e serrilha; aqui cada pixel de destino é a média ponderada de
 *  toda a área de origem que ele cobre. Separável (horizontal, depois
 *  vertical) pra não pagar O(ratio²) por pixel. */
function areaAxis(
  src: Float32Array,
  sw: number,
  sh: number,
  dw: number,
  horizontal: boolean,
): Float32Array {
  const n = horizontal ? sw : sh;
  const other = horizontal ? sh : sw;
  const out = new Float32Array(horizontal ? dw * sh * 4 : sw * dw * 4);
  const scale = n / dw;
  for (let d = 0; d < dw; d++) {
    const s0 = d * scale;
    const s1 = (d + 1) * scale;
    const i0 = Math.floor(s0);
    const i1 = Math.min(n - 1, Math.ceil(s1) - 1);
    for (let o = 0; o < other; o++) {
      let acc0 = 0;
      let acc1 = 0;
      let acc2 = 0;
      let acc3 = 0;
      let wsum = 0;
      for (let i = i0; i <= i1; i++) {
        // Cobertura fracionária nas pontas — sem isso a borda ganha um viés
        // que aparece como linha clara/escura de 1 px no destino.
        const wgt = Math.min(s1, i + 1) - Math.max(s0, i);
        if (wgt <= 0) continue;
        const si = horizontal ? (o * sw + i) * 4 : (i * sw + o) * 4;
        acc0 += src[si] * wgt;
        acc1 += src[si + 1] * wgt;
        acc2 += src[si + 2] * wgt;
        acc3 += src[si + 3] * wgt;
        wsum += wgt;
      }
      const di = horizontal ? (o * dw + d) * 4 : (d * sw + o) * 4;
      out[di] = acc0 / wsum;
      out[di + 1] = acc1 / wsum;
      out[di + 2] = acc2 / wsum;
      out[di + 3] = acc3 / wsum;
    }
  }
  return out;
}

/** Ampliação bilinear. Usa a convenção de CENTRO de pixel (`+0.5`): alinhar
 *  pelas bordas desloca a imagem meio pixel — e meio pixel de deslocamento na
 *  volta é exatamente o que faria a colagem "quase" encaixar. */
function bilinear(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  const out = new Float32Array(dw * dh * 4);
  const fx = sw / dw;
  const fy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.max(0, (y + 0.5) * fy - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const wy = sy - y0;
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.max(0, (x + 0.5) * fx - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const wx = sx - x0;
      const a = (y0 * sw + x0) * 4;
      const b = (y0 * sw + x1) * 4;
      const c = (y1 * sw + x0) * 4;
      const d = (y1 * sw + x1) * 4;
      const o = (y * dw + x) * 4;
      for (let k = 0; k < 4; k++) {
        const top = src[a + k] * (1 - wx) + src[b + k] * wx;
        const bot = src[c + k] * (1 - wx) + src[d + k] * wx;
        out[o + k] = top * (1 - wy) + bot * wy;
      }
    }
  }
  return out;
}

/** Reamostra RGBA. Reduzir usa média de área, ampliar usa bilinear, e tamanho
 *  igual devolve cópia (o caso comum quando a janela já é 512 — nenhum pixel
 *  é tocado por interpolação à toa). */
export function resample(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8ClampedArray {
  if (sw === dw && sh === dh) return new Uint8ClampedArray(src);
  const f = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) f[i] = src[i];
  // Por eixo: um documento achatado pode reduzir num e ampliar no outro.
  const midW = dw <= sw ? areaAxis(f, sw, sh, dw, true) : null;
  const stageW = midW ?? bilinear(f, sw, sh, dw, sh);
  const midH = dh <= sh ? areaAxis(stageW, dw, sh, dh, false) : bilinear(stageW, dw, sh, dw, dh);
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(midH[i]);
  return out;
}

/** Reduz a máscara binária pro 512 por MÁXIMO, não por média: um pixel de
 *  buraco que some na redução vira um pixel do objeto que o LaMa não apaga —
 *  e sobra como pontinho do objeto removido. Cobrir a mais é inofensivo (o
 *  entorno é reinventado plausível); cobrir a menos deixa vestígio. */
export function resampleMaskMax(
  mask: Uint8Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8Array {
  if (sw === dw && sh === dh) return new Uint8Array(mask);
  const out = new Uint8Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor((y * sh) / dh);
    const y1 = Math.max(y0 + 1, Math.ceil(((y + 1) * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor((x * sw) / dw);
      const x1 = Math.max(x0 + 1, Math.ceil(((x + 1) * sw) / dw));
      let on = 0;
      for (let sy = y0; sy < y1 && sy < sh && !on; sy++) {
        for (let sx = x0; sx < x1 && sx < sw; sx++) {
          if (mask[sy * sw + sx]) {
            on = 1;
            break;
          }
        }
      }
      out[y * dw + x] = on;
    }
  }
  return out;
}

/** RGBA → tensor `image` do LaMa: CHW, float32, **dividido por 255**.
 *  A escala foi MEDIDA, não suposta: com a entrada em 0–255 o modelo devolve
 *  lixo (erro médio ~112 fora do buraco); com 0–1 ele reproduz a região
 *  conhecida byte a byte (erro 0,00). O alpha é ignorado — o LaMa é RGB. */
export function toLamaImage(rgba: Uint8ClampedArray, w: number, h: number): Float32Array {
  const n = w * h;
  const out = new Float32Array(3 * n);
  for (let p = 0; p < n; p++) {
    out[p] = rgba[p * 4] / 255;
    out[n + p] = rgba[p * 4 + 1] / 255;
    out[2 * n + p] = rgba[p * 4 + 2] / 255;
  }
  return out;
}

/** Máscara binária → tensor `mask` do LaMa. **1 = BURACO** (ver o topo). */
export function toLamaMask(mask: Uint8Array): Float32Array {
  const out = new Float32Array(mask.length);
  for (let p = 0; p < mask.length; p++) out[p] = mask[p] ? 1 : 0;
  return out;
}

/** Saída do LaMa (CHW float32 em 0–255, medido) → RGBA opaco. */
export function fromLamaOutput(out: Float32Array, w: number, h: number): Uint8ClampedArray {
  const n = w * h;
  const rgba = new Uint8ClampedArray(n * 4);
  for (let p = 0; p < n; p++) {
    rgba[p * 4] = out[p];
    rgba[p * 4 + 1] = out[n + p];
    rgba[p * 4 + 2] = out[2 * n + p];
    rgba[p * 4 + 3] = 255;
  }
  return rgba;
}

/** Cola o preenchimento no recorte SÓ onde a máscara liga (muta `base`).
 *
 *  O alpha do buraco vira 255: "remover objeto" quer dizer "põe atrás o que
 *  deveria estar lá", e o que está atrás é opaco. Fora do buraco nada é
 *  tocado — nem o RGB nem o alpha — e é isso que o teste trava. */
export function blendHole(
  base: Uint8ClampedArray,
  filled: Uint8ClampedArray,
  mask: Uint8Array,
): void {
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const i = p * 4;
    base[i] = filled[i];
    base[i + 1] = filled[i + 1];
    base[i + 2] = filled[i + 2];
    base[i + 3] = 255;
  }
}
