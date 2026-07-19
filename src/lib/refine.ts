/** Matemática PURA do modo Refinar da remoção de fundo (fatia ③).
 *
 *  Convenção: máscara 0–255 (a do matte.ts — alpha contínuo), NÃO a 0/1 do
 *  mask.ts (seleção binária). Os dois tipos não se misturam de propósito —
 *  ver análise §4.1: o refino vive só durante o modo e morre no Aplicar.
 *
 *  O PINCEL não mora mais aqui: `paintMaskDab` migrou pro `maskpaint.ts` na
 *  fatia ⑦, quando o remover objeto passou a pintar máscara também. O que
 *  sobrou neste arquivo é o que é REALMENTE do refino — o blur da borda e a
 *  recomposição do preview (RGB original × máscara), que não fazem sentido
 *  num modo cuja máscara é instrução pro modelo e não altera pixel nenhum.
 *
 *  Tudo aqui é Uint8ClampedArray sem canvas — testável em Node no vitest.
 */

import type { Rect } from "./geometry";
import { overlayRectRgba } from "./maskpaint";

/** Box blur separável em UM canal (a mesma matemática do boxBlur dos filtros,
 *  sem RGBA nem premultiply — máscara não tem cor pra sangrar). 3 passadas ≈
 *  gaussiano; borda estendida. Devolve CÓPIA borrada — a base fica intacta
 *  (o slider re-borra sempre a partir da base, sem acumular). */
export function blurMask(mask: Uint8ClampedArray, w: number, h: number, radius: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(mask);
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return out;

  const n = w * h;
  const src = new Float32Array(n);
  for (let i = 0; i < n; i++) src[i] = mask[i];
  const tmp = new Float32Array(n);
  const passes = 3;
  const boxR = Math.max(1, Math.round(r / Math.sqrt(passes)));

  const blurAxis = (horizontal: boolean) => {
    const len = horizontal ? w : h;
    const lines = horizontal ? h : w;
    const stride = horizontal ? 1 : w;
    const lineStride = horizontal ? w : 1;
    const win = 2 * boxR + 1;
    for (let li = 0; li < lines; li++) {
      const base = li * lineStride;
      let sum = 0;
      for (let k = -boxR; k <= boxR; k++) {
        const idx = Math.min(len - 1, Math.max(0, k));
        sum += src[base + idx * stride];
      }
      for (let x = 0; x < len; x++) {
        tmp[base + x * stride] = sum / win;
        const outIdx = Math.max(0, x - boxR);
        const inIdx = Math.min(len - 1, x + boxR + 1);
        sum += src[base + inIdx * stride] - src[base + outIdx * stride];
      }
    }
    src.set(tmp.subarray(0, n));
  };

  for (let p = 0; p < passes; p++) {
    blurAxis(true);
    blurAxis(false);
  }
  for (let i = 0; i < n; i++) out[i] = src[i];
  return out;
}

/** Distância de Chebyshev (8-conexa) até o pixel de transição mais próximo,
 *  em DUAS passadas O(n) — a alternativa (dilatar 3×3 N vezes, como o morph do
 *  mask.ts) custaria N passadas, e com raio 30 numa foto de 12 M isso é meio
 *  bilhão de operações só pra achar onde a borda mora. O resultado é idêntico
 *  ao da dilatação iterada porque a dilatação 3×3 É a bola de Chebyshev.
 *
 *  "Transição" = pixel meio-transparente, ou pixel extremo que faz vizinhança
 *  com o extremo oposto (máscara dura de 0 pra 255 não tem meio-termo pra
 *  detectar, e é justamente ela que mais precisa de suavização). */
function chamferDistance(seed: Uint8Array, w: number, h: number): Int32Array {
  const n = w * h;
  const BIG = 1 << 28;
  const d = new Int32Array(n);
  for (let p = 0; p < n; p++) d[p] = seed[p] ? 0 : BIG;
  // Ida (vizinhos já visitados: cima-esquerda, cima, cima-direita, esquerda).
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (d[p] === 0) continue;
      let m = d[p];
      if (y > 0) {
        if (x > 0 && d[p - w - 1] + 1 < m) m = d[p - w - 1] + 1;
        if (d[p - w] + 1 < m) m = d[p - w] + 1;
        if (x < w - 1 && d[p - w + 1] + 1 < m) m = d[p - w + 1] + 1;
      }
      if (x > 0 && d[p - 1] + 1 < m) m = d[p - 1] + 1;
      d[p] = m;
    }
  }
  // Volta (os outros quatro vizinhos).
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const p = y * w + x;
      if (d[p] === 0) continue;
      let m = d[p];
      if (y < h - 1) {
        if (x > 0 && d[p + w - 1] + 1 < m) m = d[p + w - 1] + 1;
        if (d[p + w] + 1 < m) m = d[p + w] + 1;
        if (x < w - 1 && d[p + w + 1] + 1 < m) m = d[p + w + 1] + 1;
      }
      if (x < w - 1 && d[p + 1] + 1 < m) m = d[p + 1] + 1;
      d[p] = m;
    }
  }
  return d;
}

/** Distância até a transição da máscara — sementes = pixel meio-transparente,
 *  ou pixel extremo encostado no extremo oposto (máscara dura de 0 pra 255 não
 *  tem meio-termo pra detectar, e é justamente ela que mais precisa do blur). */
function edgeDistance(mask: Uint8ClampedArray, w: number, h: number): Int32Array {
  const seed = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const v = mask[p];
      if (v > 0 && v < 255) {
        seed[p] = 1;
        continue;
      }
      const opp = v === 0 ? 255 : 0;
      if (
        (x > 0 && mask[p - 1] === opp) ||
        (x < w - 1 && mask[p + 1] === opp) ||
        (y > 0 && mask[p - w] === opp) ||
        (y < h - 1 && mask[p + w] === opp)
      ) {
        seed[p] = 1;
      }
    }
  }
  return chamferDistance(seed, w, h);
}

/** Suaviza SÓ a faixa da borda (raio em px). Duas economias sobre borrar a
 *  máscara inteira, e as duas importam numa foto de 12 M de pixels:
 *
 *  1. O blur roda só no bounding box da faixa — no retrato típico o objeto
 *     ocupa uma fração do quadro, e o resto do buffer nem é tocado.
 *  2. O valor borrado só é ESCRITO dentro da faixa. Borrar o interior sólido
 *     devolveria 255 de novo (média de uma região uniforme é ela mesma), então
 *     o único efeito seria gastar tempo — e correr o risco de o arredondamento
 *     float roubar 1 de alpha do miolo, que vira banding em gradiente.
 *
 *  A faixa é dilatada `raio + 2` além da transição: o blur de 3 passadas
 *  espalha ~`raio`, então na fronteira da faixa o valor borrado já é igual ao
 *  original (uniforme) e não há degrau na emenda. */
export function featherMask(
  mask: Uint8ClampedArray,
  w: number,
  h: number,
  radius: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(mask);
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return out;

  const reach = r + 2;
  const d = edgeDistance(mask, w, h);
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[y * w + x] <= reach) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return out; // máscara sem borda nenhuma (toda cheia ou vazia)

  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const sub = new Uint8ClampedArray(bw * bh);
  for (let j = 0; j < bh; j++) {
    for (let i = 0; i < bw; i++) sub[j * bw + i] = mask[(minY + j) * w + minX + i];
  }
  const blurred = blurMask(sub, bw, bh, r);
  for (let j = 0; j < bh; j++) {
    for (let i = 0; i < bw; i++) {
      const p = (minY + j) * w + minX + i;
      if (d[p] <= reach) out[p] = blurred[j * bw + i];
    }
  }
  return out;
}

/** Acima disto o pixel é objeto puro; abaixo do CLEAR_AT é fundo puro. Não são
 *  0 e 255 porque a máscara do isnet chega do upscale bilinear com sujeira de
 *  ±1 nos extremos — exigir o extremo exato descartaria quase toda a
 *  vizinhança boa. */
export const OPAQUE_AT = 250;
export const CLEAR_AT = 5;

/** DESCONTAMINAR a cor da borda — o que separa um recorte que "parece
 *  photoshopado" de um que não parece.
 *
 *  O problema: num pixel semitransparente o que a câmera gravou é uma MISTURA,
 *  `C = α·F + (1−α)·B`, com F a cor real do objeto e B a do fundo velho.
 *  Recortar mexe só no alpha, então esse resíduo de B viaja junto e vira um
 *  halo com a cor do fundo antigo — visível assim que a imagem pousa num fundo
 *  de cor diferente. É exatamente o caso do gato branco sobre tapete claro: a
 *  franja do pelo sai lavada porque carrega o tapete dentro dela.
 *
 *  A conta. Queremos F, temos C e α, e estimamos F e B pelos vizinhos: F_est
 *  como média ponderada dos vizinhos OPACOS (α≈255, objeto puro) e B_est dos
 *  TRANSPARENTES (α≈0, fundo puro). Isolar F da mistura dá
 *  `F = (C − (1−α)·B_est) / α`, que é exato mas divide por α — e α→0 explode o
 *  ruído justo onde a estimativa é pior. A saída canônica é encolher a
 *  estimativa em direção a F_est com peso (1−α):
 *
 *      F = α · [(C − (1−α)·B_est)/α] + (1−α) · F_est
 *
 *  e o α do numerador cancela com o denominador, sobrando
 *
 *      F = C + (1−α) · (F_est − B_est)
 *
 *  que é o que este código faz: uma soma, SEM divisão, logo sem explosão
 *  numérica em nenhum α. Lida em português: "devolva ao pixel a fração de cor
 *  que o fundo velho roubou dele". Os extremos conferem sozinhos — em α=1 não
 *  mexe em nada (C já é F), em α=0 o C é o próprio B e o resultado cai em
 *  F_est. Nada de sofisticação: a versão simples já tira o halo (medido).
 *
 *  Só o RGB é reescrito; o alpha é de quem chamou. Roda ANTES do
 *  `applyMaskAlpha` de propósito — é ele que preserva os RGB do fundo debaixo
 *  do alpha zerado, e são esses RGB que servem de B_est aqui.
 *
 *  Muta o `rgba` in place e devolve quantos pixels reescreveu (a métrica das
 *  provas). Pixel sem NENHUM vizinho opaco fica intocado: sem referência da
 *  cor do objeto, qualquer palpite inventa cor.
 *
 *  CONTRATO DO RAIO: ele precisa ATRAVESSAR a franja — achar objeto puro de um
 *  lado e fundo puro do outro. Franja mais larga que o raio (é o que o
 *  "suavizar borda" no talo produz) faz a busca voltar vazia e o pixel fica
 *  como estava; o defeito continua visível, o que é de longe melhor que uma
 *  borda pintada com cor chutada. Por isso quem chama soma o raio do feather
 *  ao raio pedido pelo usuário (ver `state/refine.ts`). */
export function decontaminateEdge(
  rgba: Uint8ClampedArray,
  mask: Uint8ClampedArray,
  w: number,
  h: number,
  radius: number,
): number {
  const r = Math.max(1, Math.round(radius));
  // A cor de saída não pode virar entrada da estimativa do vizinho seguinte,
  // senão a correção se propaga pra dentro do objeto e vaza cor — por isso a
  // leitura é sempre da cópia intocada.
  const src = new Uint8ClampedArray(rgba);
  let touched = 0;

  // PENEIRA (medida na foto real, não teórica): a máscara do isnet chega com
  // ~9% do quadro em alpha intermediário, mas só ~7% DISSO é borda de verdade —
  // o resto são manchas de baixa confiança no meio do objeto, longe de qualquer
  // pixel opaco ou transparente. Sem esta peneira, 93% dos pixels pagavam duas
  // varreduras de janela pra no fim não achar par e serem descartados: 4,0 s
  // numa foto de 12 Mpx. Duas distâncias O(n) respondem "existe objeto puro E
  // fundo puro ao alcance?" antes de qualquer janela, e o custo cai pra ~0,9 s.
  const maxReach = r * 2;
  const opaqueSeed = new Uint8Array(w * h);
  const clearSeed = new Uint8Array(w * h);
  for (let p = 0; p < mask.length; p++) {
    if (mask[p] >= OPAQUE_AT) opaqueSeed[p] = 1;
    else if (mask[p] <= CLEAR_AT) clearSeed[p] = 1;
  }
  const distOpaque = chamferDistance(opaqueSeed, w, h);
  const distClear = chamferDistance(clearSeed, w, h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const a = mask[p];
      if (a <= CLEAR_AT || a >= OPAQUE_AT) continue; // só a franja é misturada
      // Chebyshev subestima a euclidiana, então isto nunca descarta um pixel
      // que a janela circular teria atendido — é peneira, não mudança de saída.
      // Exige as DUAS referências: sem fundo puro ao alcance não dá pra saber
      // que cor foi roubada, e mexer assim mesmo repintaria as manchas de baixa
      // confiança do MEIO do objeto, que não são borda e não têm halo nenhum.
      if (distOpaque[p] > maxReach || distClear[p] > maxReach) continue;

      // Duas tentativas de raio. Com "suavizar borda" no talo a franja fica
      // mais larga que o raio pedido e o vizinho opaco cai fora dele; dobrar o
      // alcance só pros pixels que falharam é mais barato que buscar largo em
      // todos, e evita acoplar este raio ao do feather lá no estado.
      let fr = 0;
      let fg = 0;
      let fb = 0;
      let fw = 0;
      let br = 0;
      let bg = 0;
      let bb = 0;
      let bwt = 0;
      for (let attempt = 0; attempt < 2; attempt++) {
        const rad = attempt === 0 ? r : r * 2;
        fr = fg = fb = fw = 0;
        br = bg = bb = bwt = 0;
        const y0 = Math.max(0, y - rad);
        const y1 = Math.min(h - 1, y + rad);
        const x0 = Math.max(0, x - rad);
        const x1 = Math.min(w - 1, x + rad);
        for (let ny = y0; ny <= y1; ny++) {
          for (let nx = x0; nx <= x1; nx++) {
            const q = ny * w + nx;
            const av = mask[q];
            const opaque = av >= OPAQUE_AT;
            const clear = av <= CLEAR_AT;
            if (!opaque && !clear) continue;
            const dx = nx - x;
            const dy = ny - y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > rad) continue; // janela circular: quadrada enviesa nas diagonais
            const wt = 1 / (1 + dist);
            const i = q * 4;
            if (opaque) {
              fr += src[i] * wt;
              fg += src[i + 1] * wt;
              fb += src[i + 2] * wt;
              fw += wt;
            } else {
              br += src[i] * wt;
              bg += src[i + 1] * wt;
              bb += src[i + 2] * wt;
              bwt += wt;
            }
          }
        }
        if (fw > 0 && bwt > 0) break;
      }
      if (fw <= 0) continue; // sem cor de objeto por perto — não inventa

      const i = p * 4;
      const inv = 1 - a / 255;
      if (bwt > 0) {
        // F = C + (1−α)·(F_est − B_est)
        rgba[i] = src[i] + inv * (fr / fw - br / bwt);
        rgba[i + 1] = src[i + 1] + inv * (fg / fw - bg / bwt);
        rgba[i + 2] = src[i + 2] + inv * (fb / fw - bb / bwt);
      } else {
        // Sem fundo puro por perto não dá pra saber o que foi roubado; o melhor
        // palpite disponível é a própria cor do objeto, com o mesmo peso.
        rgba[i] = src[i] + inv * (fr / fw - src[i]);
        rgba[i + 1] = src[i + 1] + inv * (fg / fw - src[i + 1]);
        rgba[i + 2] = src[i + 2] + inv * (fb / fw - src[i + 2]);
      }
      touched++;
    }
  }
  return touched;
}

/** RGBA do retângulo do preview: RGB do ORIGINAL, alpha = alphaOriginal ×
 *  máscara/255 (a multiplicação do matte — pixel meio-transparente não fica
 *  mais opaco por causa do refino). Não toca o original. */
export function composeRectRgba(
  orig: Uint8ClampedArray,
  mask: Uint8ClampedArray,
  w: number,
  rect: Rect,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rect.w * rect.h * 4);
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const p = (rect.y + y) * w + rect.x + x;
      const o = (y * rect.w + x) * 4;
      out[o] = orig[p * 4];
      out[o + 1] = orig[p * 4 + 1];
      out[o + 2] = orig[p * 4 + 2];
      out[o + 3] = Math.round((orig[p * 4 + 3] * mask[p]) / 255);
    }
  }
  return out;
}

/** Vermelho do véu — o convencional de máscara em editor de imagem. Mesmo tom
 *  nos dois modos de propósito: "vermelho translúcido = a IA mexe aqui". */
export const VEIL_RGB = { r: 255, g: 40, b: 70 } as const;

/** RGBA do retângulo do VÉU: onde a máscara removeu (valor baixo), um véu
 *  vermelho semitransparente proporcional; onde manteve, nada. É o overlay
 *  opcional que mostra "o que a IA jogou fora" por cima do checkerboard.
 *  INVERTIDO em relação ao véu do remover objeto — aqui máscara baixa é o
 *  buraco; lá o pintado é o buraco. Mesma função, direções opostas. */
export function veilRectRgba(mask: Uint8ClampedArray, w: number, rect: Rect): Uint8ClampedArray {
  return overlayRectRgba(mask, w, rect, { ...VEIL_RGB, a: 0.45 }, true);
}
