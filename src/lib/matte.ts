/** Matemática pura da remoção de fundo (backlog B4) — SEM DOM, SEM onnx.
 *
 *  O `bgremove.ts` (que importa onnxruntime e Tauri) fica intestável em Node;
 *  o que dá pra provar com arrays pequenos mora aqui, no padrão da suíte
 *  ("libs puras testáveis em Node", ver docs/planos/localpaint.md).
 *
 *  Pré-processamento do isnet, conferido contra o rembg (`DisSession`):
 *  entrada 1024×1024 RGB, normalização `px/255` com mean 0.5 e std 1.0 —
 *  NÃO é a do ImageNet (que o u2net usa). Pós: o mapa de saliência sai em
 *  escala arbitrária e o rembg re-escala por min-max antes de virar alpha.
 */

/** RGBA → tensor CHW float32 do isnet: (px/255 − 0.5) / 1.0, canal a canal. */
export function toIsnetInput(rgba: Uint8ClampedArray, w: number, h: number): Float32Array {
  const plane = w * h;
  const chw = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    chw[i] = rgba[i * 4] / 255 - 0.5;
    chw[plane + i] = rgba[i * 4 + 1] / 255 - 0.5;
    chw[plane * 2 + i] = rgba[i * 4 + 2] / 255 - 0.5;
  }
  return chw;
}

/** Saliência crua → alpha 0–255, re-escalada por min-max (como o rembg faz).
 *  Mapa constante (min == max) vira tudo 0 — sem divisão por zero. */
export function saliencyToAlpha(map: Float32Array): Uint8ClampedArray {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < map.length; i++) {
    if (map[i] < min) min = map[i];
    if (map[i] > max) max = map[i];
  }
  const out = new Uint8ClampedArray(map.length);
  const range = max - min;
  if (range <= 0) return out;
  for (let i = 0; i < map.length; i++) {
    out[i] = Math.round(((map[i] - min) / range) * 255);
  }
  return out;
}

/** Aplica a máscara como alpha, MULTIPLICANDO pelo alpha que já existe
 *  (pixel meio-transparente não pode ficar mais opaco por causa do recorte).
 *  Muta o `rgba` in place; um pixel por entrada da máscara. */
export function applyMaskAlpha(rgba: Uint8ClampedArray, mask: Uint8ClampedArray): void {
  const n = Math.min(mask.length, rgba.length >> 2);
  for (let i = 0; i < n; i++) {
    rgba[i * 4 + 3] = Math.round((rgba[i * 4 + 3] * mask[i]) / 255);
  }
}
