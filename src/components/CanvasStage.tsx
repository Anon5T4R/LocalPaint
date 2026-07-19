/** O palco — onde TODA a pintura acontece.
 *
 *  Arquitetura (a decisão que rege o arquivo): o traço NÃO passa pelo React.
 *  Pointer events pintam direto no canvas da camada ativa; um rAF compõe as
 *  camadas no canvas de exibição (`onRender`/`requestRender` em layers.ts).
 *  React só entra pra montar o componente e reagir a troca de doc/ferramenta.
 *
 *  Undo por DIRTY-RECT: no início de cada gesto o canvas da camada é copiado
 *  pra um temp (drawImage — cópia GPU, sem readback); no fim, o bbox do gesto
 *  vira dois getImageData (antes, do temp; depois, da camada) e entra no
 *  histórico. Um traço pequeno custa KBs, não o documento inteiro.
 */

import { useEffect, useRef } from "react";

import { rgbaToCss, type Rgba } from "../lib/color";
import { floodFill, floodFillSelect } from "../lib/fill";
import { maskOutline, maskRunRects, rectMask, unionSel } from "../lib/mask";
import {
  bresenham,
  clampRect,
  constrainAngle,
  constrainSquare,
  normRect,
  strokeBbox,
  unionRect,
  type Rect,
} from "../lib/geometry";
import type { HistoryEntry } from "../lib/history";
import { getLayerCanvas, layerCtx, onRender, requestRender } from "../lib/layers";
import { compositeInto } from "../lib/compose";
import { strokePoints } from "../lib/maskpaint";
import { useDoc } from "../state/doc";
import { getObjMaskCanvas, useObjMask } from "../state/objmask";
import { getVeilCanvas, useRefine } from "../state/refine";
import { getFloatingCanvas, useSelection } from "../state/selection";
import { useTools, type Tool } from "../state/tools";
import ObjMaskBar from "./ObjMaskBar";
import RefineBar from "./RefineBar";

/** Um modo que captura o gesto inteiro pra pintar MÁSCARA em vez de pixels
 *  (Refinar da remoção de fundo, máscara do remover objeto). Os dois têm o
 *  mesmo gesto e o CanvasStage não precisa saber de qual se trata — só de
 *  quem recebe o dab. Ver `lib/maskpaint.ts` sobre o que é compartilhado. */
interface MaskBrush {
  /** true quando o dab APAGA da máscara (o botão direito inverte na hora). */
  erasing: (rightButton: boolean) => boolean;
  paintAt: (x: number, y: number, radius: number, erase: boolean) => void;
  endStroke: () => void;
}

/** O modo de máscara ativo, se houver. Refinar tem precedência só porque os
 *  dois nunca coexistem (o App bloqueia abrir um com o outro vivo). */
function activeMaskBrush(): MaskBrush | null {
  const refine = useRefine.getState();
  if (refine.active) {
    return {
      erasing: (rb) => (refine.mode === "erase") !== rb,
      paintAt: refine.paintAt,
      endStroke: refine.endStroke,
    };
  }
  const objmask = useObjMask.getState();
  if (objmask.active) {
    return {
      erasing: (rb) => (objmask.mode === "erase") !== rb,
      paintAt: objmask.paintAt,
      endStroke: objmask.endStroke,
    };
  }
  return null;
}

interface View {
  scale: number;
  ox: number;
  oy: number;
}

/** Preview de forma em andamento (desenhada por cima da composição). */
interface ShapePreview {
  tool: "line" | "rect" | "ellipse";
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const CHECKER = 8;

function makeChecker(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = CHECKER * 2;
  c.height = CHECKER * 2;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#cfcfcf";
  ctx.fillRect(0, 0, CHECKER * 2, CHECKER * 2);
  ctx.fillStyle = "#ececec";
  ctx.fillRect(0, 0, CHECKER, CHECKER);
  ctx.fillRect(CHECKER, CHECKER, CHECKER, CHECKER);
  return c;
}

export default function CanvasStage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Tudo que muda a cada frame mora em refs — nada de setState em pointermove.
  const view = useRef<View>({ scale: 1, ox: 40, oy: 40 });
  const fitted = useRef(false);
  const spaceDown = useRef(false);
  const panning = useRef<{ x: number; y: number } | null>(null);
  const mouse = useRef<{ x: number; y: number } | null>(null);
  const shape = useRef<ShapePreview | null>(null);
  const stroke = useRef<{
    layerId: string;
    temp: HTMLCanvasElement;
    points: { x: number; y: number }[];
    radius: number;
    color: Rgba;
    last: { x: number; y: number } | null;
    tool: Tool;
  } | null>(null);
  const checker = useRef<HTMLCanvasElement | null>(null);
  // Gesto da ferramenta de seleção: marquee em criação OU arrasto do recorte.
  const marquee = useRef<{ x0: number; y0: number } | null>(null);
  const selDrag = useRef<{ lastX: number; lastY: number; lifted: boolean } | null>(null);
  // Traço de um modo de MÁSCARA (Refinar ou máscara do remover objeto): pinta
  // a máscara do modo, nunca a camada. `brush` fica preso no gesto — trocar de
  // modo no meio de um arrasto não pode redirecionar os dabs.
  const maskDrag = useRef<{ brush: MaskBrush; erase: boolean; last: { x: number; y: number } } | null>(null);
  // Path2Ds da seleção MASCARADA, cacheados pela identidade da máscara (ela é
  // imutável por seleção): `outline` = contorno de verdade das marching ants;
  // `clip` = retângulos dos runs (fill nonzero) pro clip da pintura. Coords
  // LOCAIS ao bounds — quem desenha translada. É o cache que a análise pediu
  // pra não pagar o traçado a cada frame/segmento.
  const maskPaths = useRef<{ mask: Uint8Array; outline: Path2D; clip: Path2D } | null>(null);

  function getMaskPaths(mask: Uint8Array, w: number, h: number): { outline: Path2D; clip: Path2D } {
    const c = maskPaths.current;
    if (c && c.mask === mask) return c;
    const outline = new Path2D();
    for (const [x0, y0, x1, y1] of maskOutline(mask, w, h)) {
      outline.moveTo(x0, y0);
      outline.lineTo(x1, y1);
    }
    const clip = new Path2D();
    for (const r of maskRunRects(mask, w, h)) clip.rect(r.x, r.y, r.w, r.h);
    maskPaths.current = { mask, outline, clip };
    return maskPaths.current;
  }

  // ── composição ────────────────────────────────────────────────────────────

  useEffect(() => {
    const paint = () => {
      const canvas = canvasRef.current;
      const host = hostRef.current;
      if (!canvas || !host) return;
      const s = useDoc.getState();
      const dpr = window.devicePixelRatio || 1;
      const cw = host.clientWidth;
      const ch = host.clientHeight;
      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
        canvas.style.width = `${cw}px`;
        canvas.style.height = `${ch}px`;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Fundo do palco (fora do documento) vem do tema via CSS variable.
      ctx.clearRect(0, 0, cw, ch);
      if (!s.open) return;

      // Primeiro doc na tela: enquadra (uma vez só — depois o zoom é do usuário).
      if (!fitted.current) {
        fitted.current = true;
        fitView(cw, ch, s.width, s.height);
      }

      const v = view.current;
      // Checkerboard SÓ sob o documento (transparência é do doc, não do palco).
      if (!checker.current) checker.current = makeChecker();
      ctx.save();
      ctx.translate(v.ox, v.oy);
      ctx.scale(v.scale, v.scale);
      const pat = ctx.createPattern(checker.current, "repeat")!;
      ctx.save();
      // O padrão xadrez fica em px de TELA (não escala com o zoom — senão em
      // 32× cada quadrado vira um paredão).
      ctx.fillStyle = pat;
      ctx.save();
      ctx.scale(1 / v.scale, 1 / v.scale);
      ctx.fillRect(0, 0, s.width * v.scale, s.height * v.scale);
      ctx.restore();
      ctx.restore();

      // Pixel-perfect no zoom alto; suave no zoom baixo.
      ctx.imageSmoothingEnabled = v.scale < 1;
      compositeInto(ctx, s.layers);

      // Recorte flutuante da seleção (pixels levantados, seguindo o arrasto).
      const sel = useSelection.getState();
      if (sel.floating && sel.rect) {
        const fc = getFloatingCanvas();
        if (fc) ctx.drawImage(fc, sel.rect.x, sel.rect.y);
      }

      // Véu do modo Refinar: vermelho translúcido onde a máscara removeu.
      const refine = useRefine.getState();
      if (refine.active && refine.veil) {
        const vc = getVeilCanvas();
        if (vc) ctx.drawImage(vc, 0, 0);
      }

      // Véu do modo "pintar a máscara": vermelho translúcido no que vai sumir.
      // Aqui ele NÃO é opcional — é a única prova visual do que o modelo vai
      // receber (nenhum pixel do documento mudou ainda).
      const objmask = useObjMask.getState();
      if (objmask.active) {
        const oc = getObjMaskCanvas();
        if (oc) ctx.drawImage(oc, 0, 0);
      }

      // Preview de forma por cima (em coordenadas de doc).
      const sp = shape.current;
      if (sp) {
        drawShape(ctx, sp, 1 / v.scale);
      }
      ctx.restore();

      // Contorno da seleção (formigas paradas: tracejado estático — animar
      // exigiria rAF contínuo pra um enfeite). Com máscara, as formigas
      // seguem o CONTORNO real (Path2D cacheado por seleção), não o bbox.
      if (sel.rect && sel.mask) {
        const r = sel.rect;
        const { outline } = getMaskPaths(sel.mask, r.w, r.h);
        ctx.save();
        // Desenha em espaço de DOC (o path é local ao bounds) com traço e
        // tracejado compensados pra 1px de TELA.
        ctx.translate(v.ox, v.oy);
        ctx.scale(v.scale, v.scale);
        ctx.translate(r.x, r.y);
        ctx.lineWidth = 1 / v.scale;
        ctx.setLineDash([6 / v.scale, 4 / v.scale]);
        ctx.strokeStyle = "#000";
        ctx.stroke(outline);
        ctx.strokeStyle = "#fff";
        ctx.lineDashOffset = 5 / v.scale;
        ctx.stroke(outline);
        ctx.restore();
      } else if (sel.rect) {
        const r = sel.rect;
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 1;
        ctx.strokeRect(v.ox + r.x * v.scale + 0.5, v.oy + r.y * v.scale + 0.5, r.w * v.scale, r.h * v.scale);
        ctx.strokeStyle = "#fff";
        ctx.lineDashOffset = 5;
        ctx.strokeRect(v.ox + r.x * v.scale + 0.5, v.oy + r.y * v.scale + 0.5, r.w * v.scale, r.h * v.scale);
        ctx.restore();
      }

      // Cursor de pincel (círculo do diâmetro real) — em px de tela. No modo
      // Refinar o círculo aparece SEMPRE (a ferramenta ativa é irrelevante lá).
      const m = mouse.current;
      const tool = useTools.getState().tool;
      if (m && (refine.active || objmask.active || tool === "brush" || tool === "eraser" || tool === "pencil")) {
        const d = useTools.getState().size * v.scale;
        ctx.strokeStyle = "rgba(0,0,0,.7)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(m.x, m.y, Math.max(1, d / 2), 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,.7)";
        ctx.beginPath();
        ctx.arc(m.x, m.y, Math.max(1, d / 2) + 1, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Borda do documento.
      ctx.strokeStyle = "rgba(128,128,128,.6)";
      ctx.strokeRect(v.ox - 0.5, v.oy - 0.5, s.width * v.scale + 1, s.height * v.scale + 1);
    };

    onRender(paint);
    requestRender();

    const un1 = useDoc.subscribe(() => requestRender());
    const un2 = useTools.subscribe(() => requestRender());
    const un3 = useRefine.subscribe(() => requestRender());
    const un4 = useObjMask.subscribe(() => requestRender());
    const ro = new ResizeObserver(() => requestRender());
    if (hostRef.current) ro.observe(hostRef.current);
    return () => {
      un1();
      un2();
      un3();
      un4();
      ro.disconnect();
    };
  }, []);

  // Reset do enquadramento quando o doc troca (novo/abrir).
  const docKey = useDoc((s) => `${s.open}:${s.width}x${s.height}:${s.filePath ?? ""}`);
  useEffect(() => {
    fitted.current = false;
    requestRender();
  }, [docKey]);

  function fitView(cw: number, ch: number, dw: number, dh: number) {
    const margin = 48;
    const scale = Math.min((cw - margin) / dw, (ch - margin) / dh, 1);
    const s = Math.max(0.05, scale);
    view.current = {
      scale: s,
      ox: (cw - dw * s) / 2,
      oy: (ch - dh * s) / 2,
    };
  }

  function drawShape(ctx: CanvasRenderingContext2D, sp: ShapePreview, hairline: number) {
    const tools = useTools.getState();
    const stroke = rgbaToCss(tools.primary);
    const fill = rgbaToCss(tools.shapeMode === "fill" ? tools.primary : tools.secondary);
    ctx.lineWidth = tools.size;
    ctx.strokeStyle = stroke;
    ctx.fillStyle = fill;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (sp.tool === "line") {
      ctx.beginPath();
      ctx.moveTo(sp.x0 + 0.5, sp.y0 + 0.5);
      ctx.lineTo(sp.x1 + 0.5, sp.y1 + 0.5);
      ctx.stroke();
      return;
    }
    const r = normRect(sp.x0, sp.y0, sp.x1, sp.y1);
    ctx.beginPath();
    if (sp.tool === "rect") {
      ctx.rect(r.x + 0.5, r.y + 0.5, r.w, r.h);
    } else {
      ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
    }
    if (tools.shapeMode !== "stroke") ctx.fill();
    if (tools.shapeMode !== "fill") ctx.stroke();
    // Guia fina por cima pra forma não "sumir" com traço grosso transparente.
    void hairline;
  }

  // ── coordenadas ───────────────────────────────────────────────────────────

  function toDoc(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = canvasRef.current!.getBoundingClientRect();
    const v = view.current;
    return {
      x: (e.clientX - rect.left - v.ox) / v.scale,
      y: (e.clientY - rect.top - v.oy) / v.scale,
    };
  }

  // ── undo helpers ──────────────────────────────────────────────────────────

  function beginTemp(layerId: string): HTMLCanvasElement {
    const src = getLayerCanvas(layerId)!;
    const temp = document.createElement("canvas");
    temp.width = src.width;
    temp.height = src.height;
    temp.getContext("2d")!.drawImage(src, 0, 0);
    return temp;
  }

  function commitDirtyRect(layerId: string, temp: HTMLCanvasElement, r: Rect | null, label: string) {
    const s = useDoc.getState();
    const rect = r ? clampRect(r, s.width, s.height) : null;
    if (!rect) return;
    const before = temp.getContext("2d", { willReadFrequently: true })!.getImageData(rect.x, rect.y, rect.w, rect.h);
    const after = layerCtx(layerId).getImageData(rect.x, rect.y, rect.w, rect.h);
    const entry: HistoryEntry = {
      label,
      bytes: before.data.byteLength * 2,
      undo: () => {
        const c = getLayerCanvas(layerId);
        if (c) layerCtx(layerId).putImageData(before, rect.x, rect.y);
      },
      redo: () => {
        const c = getLayerCanvas(layerId);
        if (c) layerCtx(layerId).putImageData(after, rect.x, rect.y);
      },
    };
    s.pushHistory(entry);
  }

  // ── gestos ────────────────────────────────────────────────────────────────

  function activeLayerId(): string | null {
    const s = useDoc.getState();
    if (!s.open || !s.activeId) return null;
    const meta = s.layers.find((l) => l.id === s.activeId);
    // Pintar em camada invisível é pintar no vazio — bloqueia o gesto.
    if (!meta || !meta.visible) return null;
    return s.activeId;
  }

  function strokeSegment(p: { x: number; y: number; pressure: number }) {
    const st = stroke.current;
    if (!st) return;
    const tools = useTools.getState();
    const ctx = layerCtx(st.layerId);
    ctx.save();
    // Com seleção ativa (e não-flutuante), a pintura fica PRESA nela — o
    // comportamento canônico de editor raster. O balde é a exceção documentada
    // (fecha na F5). Seleção mascarada usa o Path2D de runs cacheado como
    // clip; se um dia fragmentar a ponto de doer, o plano B da análise é
    // scratch canvas + destination-in.
    const selState = useSelection.getState();
    const selRect = selState.floating ? null : selState.rect;
    if (selRect) {
      if (selState.mask) {
        const { clip } = getMaskPaths(selState.mask, selRect.w, selRect.h);
        ctx.translate(selRect.x, selRect.y);
        ctx.clip(clip);
        ctx.translate(-selRect.x, -selRect.y);
      } else {
        ctx.beginPath();
        ctx.rect(selRect.x, selRect.y, selRect.w, selRect.h);
        ctx.clip();
      }
    }
    if (st.tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
      ctx.fillStyle = "rgba(0,0,0,1)";
    } else {
      ctx.strokeStyle = rgbaToCss(st.color);
      ctx.fillStyle = rgbaToCss(st.color);
    }

    if (st.tool === "pencil") {
      // Lápis: Bresenham com ponta quadrada — pixel cheio, sem anti-alias.
      const size = tools.size;
      const off = Math.floor(size / 2);
      const from = st.last ?? p;
      for (const pt of bresenham(from.x, from.y, p.x, p.y)) {
        ctx.fillRect(pt.x - off, pt.y - off, size, size);
      }
    } else {
      // Pincel/borracha: segmento redondo com largura modulada pela pressão.
      // Mouse reporta pressure 0.5 constante — o fator vira exatamente 1 e o
      // traço sai no tamanho nominal; caneta reporta 0..1 e o traço afina/
      // engorda de verdade (teto 1.2× pra pressão forte não dobrar o pincel).
      const pressure = p.pressure > 0 ? p.pressure : 0.5;
      const factor = Math.min(1.2, Math.max(0.15, pressure * 2));
      const w = Math.max(0.5, tools.size * factor);
      ctx.lineWidth = w;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const from = st.last ?? p;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    ctx.restore();

    st.points.push({ x: p.x, y: p.y });
    st.last = { x: p.x, y: p.y };
    requestRender();
  }

  function onPointerDown(e: React.PointerEvent) {
    const canvas = canvasRef.current!;
    // try/catch: capturar um pointer que o navegador não considera ativo
    // (evento sintético de automação, caneta em estado estranho) lança
    // NotFoundError — e sem o catch a exceção mataria o GESTO inteiro na
    // primeira linha. Perder a captura degrada bem (o traço só para se o
    // ponteiro sair da janela); perder o gesto não.
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* segue sem captura */
    }

    // Pan: botão do meio, ou espaço segurado.
    if (e.button === 1 || spaceDown.current) {
      panning.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;

    const s = useDoc.getState();
    if (!s.open) return;
    const tools = useTools.getState();
    const p = toDoc(e);

    // Modo de MÁSCARA captura o gesto inteiro: qualquer ferramenta vira o
    // pincel de máscara. Botão direito inverte o modo na hora.
    const brush = activeMaskBrush();
    if (brush) {
      const erase = brush.erasing(e.button === 2);
      const radius = Math.max(0.5, tools.size / 2);
      brush.paintAt(p.x, p.y, radius, erase);
      maskDrag.current = { brush, erase, last: { x: p.x, y: p.y } };
      return;
    }

    if (tools.tool === "eyedropper") {
      pickColor(p.x, p.y, e.button === 2);
      return;
    }

    if (tools.tool === "wand") {
      // Varinha amostra o COMPOSTO (sample-merged), como o conta-gotas: a
      // seleção é "o que o olho vê", não a camada ativa — decisão documentada
      // (é também o que destrava o balde sample-merged de brinde na F5). Por
      // isso ela nem exige camada ativa visível.
      if (p.x < 0 || p.y < 0 || p.x >= s.width || p.y >= s.height) return;
      const flat = document.createElement("canvas");
      flat.width = s.width;
      flat.height = s.height;
      const fctx = flat.getContext("2d", { willReadFrequently: true })!;
      compositeInto(fctx, s.layers);
      const img = fctx.getImageData(0, 0, s.width, s.height);
      const hit = floodFillSelect(img.data, s.width, s.height, p.x, p.y, tools.tolerance);
      if (!hit) return;
      const sel = useSelection.getState();
      if (e.shiftKey && sel.rect && !sel.floating) {
        // Shift = SOMA à seleção existente (materializa retângulo se preciso).
        const cur = { bounds: sel.rect, mask: sel.mask ?? rectMask(sel.rect.w, sel.rect.h) };
        sel.selectMask(unionSel(cur, hit));
      } else {
        // selectMask já passa por trimMask — máscara cheia degenera pra rect.
        sel.selectMask(hit);
      }
      return;
    }

    if (tools.tool === "select") {
      const sel = useSelection.getState();
      const insideBounds =
        sel.rect &&
        p.x >= sel.rect.x &&
        p.x < sel.rect.x + sel.rect.w &&
        p.y >= sel.rect.y &&
        p.y < sel.rect.y + sel.rect.h;
      // Seleção mascarada (parada): "dentro" é dentro da MÁSCARA — clicar num
      // buraco dela começa marquee novo, como nos editores de verdade. Com o
      // flutuante vivo, o bounds basta (o conteúdo já é só o mascarado).
      const inside =
        insideBounds &&
        (!sel.mask ||
          sel.floating ||
          sel.mask[
            (Math.floor(p.y) - sel.rect!.y) * sel.rect!.w + (Math.floor(p.x) - sel.rect!.x)
          ] === 1);
      if (inside) {
        // Arrastar o conteúdo: o corte de verdade (lift) só acontece no
        // primeiro MOVE — clicar dentro e soltar não pode cortar nada.
        selDrag.current = { lastX: p.x, lastY: p.y, lifted: sel.floating };
      } else {
        useSelection.getState().deselect();
        marquee.current = { x0: p.x, y0: p.y };
      }
      return;
    }

    const layerId = activeLayerId();
    if (!layerId) return;

    if (tools.tool === "text") {
      // O modal cuida do resto; o clique só marca ONDE (coordenada de doc).
      useTools.getState().setTextAt({ x: Math.round(p.x), y: Math.round(p.y) });
      return;
    }

    if (tools.tool === "fill") {
      const rectFull: Rect = { x: 0, y: 0, w: s.width, h: s.height };
      void rectFull;
      const ctx = layerCtx(layerId);
      const img = ctx.getImageData(0, 0, s.width, s.height);
      const beforeCopy = new Uint8ClampedArray(img.data);
      const color = e.button === 2 ? tools.secondary : tools.primary;
      const dirty = floodFill(img.data, s.width, s.height, p.x, p.y, color, tools.tolerance);
      if (!dirty) return;
      ctx.putImageData(img, 0, 0);
      // before/after recortados do dirty — não paga o doc inteiro no histórico.
      const sub = clampRect(dirty, s.width, s.height)!;
      const extract = (src: Uint8ClampedArray): ImageData => {
        const out = new ImageData(sub.w, sub.h);
        for (let y = 0; y < sub.h; y++) {
          const srcOff = ((sub.y + y) * s.width + sub.x) * 4;
          out.data.set(src.subarray(srcOff, srcOff + sub.w * 4), y * sub.w * 4);
        }
        return out;
      };
      const before = extract(beforeCopy);
      const after = extract(img.data);
      useDoc.getState().pushHistory({
        label: "fill",
        bytes: before.data.byteLength * 2,
        undo: () => layerCtx(layerId).putImageData(before, sub.x, sub.y),
        redo: () => layerCtx(layerId).putImageData(after, sub.x, sub.y),
      });
      tools.noteUsed(color);
      requestRender();
      return;
    }

    if (tools.tool === "line" || tools.tool === "rect" || tools.tool === "ellipse") {
      shape.current = { tool: tools.tool, x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      stroke.current = {
        layerId,
        temp: beginTemp(layerId),
        points: [],
        radius: tools.size,
        color: e.button === 2 ? tools.secondary : tools.primary,
        last: null,
        tool: tools.tool,
      };
      requestRender();
      return;
    }

    // pencil / brush / eraser
    const color = e.button === 2 ? tools.secondary : tools.primary;
    stroke.current = {
      layerId,
      temp: beginTemp(layerId),
      points: [],
      radius: tools.size,
      color,
      last: null,
      tool: tools.tool,
    };
    strokeSegment({ x: p.x, y: p.y, pressure: e.pressure });
  }

  function onPointerMove(e: React.PointerEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    mouse.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    if (panning.current) {
      const v = view.current;
      view.current = {
        ...v,
        ox: v.ox + (e.clientX - panning.current.x),
        oy: v.oy + (e.clientY - panning.current.y),
      };
      panning.current = { x: e.clientX, y: e.clientY };
      requestRender();
      return;
    }

    if (maskDrag.current) {
      // A interpolação do traço (passos de meio raio) mora no `strokePoints` —
      // pointermove esparso não pode deixar buraco na máscara.
      const p = toDoc(e);
      const d = maskDrag.current;
      const radius = Math.max(0.5, useTools.getState().size / 2);
      for (const q of strokePoints(d.last.x, d.last.y, p.x, p.y, radius)) {
        d.brush.paintAt(q.x, q.y, radius, d.erase);
      }
      d.last = { x: p.x, y: p.y };
      return;
    }

    if (marquee.current) {
      const p = toDoc(e);
      const m = marquee.current;
      useSelection.getState().select(normRect(m.x0, m.y0, p.x, p.y));
      return;
    }
    if (selDrag.current) {
      const p = toDoc(e);
      const d = selDrag.current;
      const dx = Math.round(p.x - d.lastX);
      const dy = Math.round(p.y - d.lastY);
      if (dx !== 0 || dy !== 0) {
        if (!d.lifted) {
          useSelection.getState().lift();
          d.lifted = true;
        }
        useSelection.getState().moveBy(dx, dy);
        d.lastX += dx;
        d.lastY += dy;
      }
      return;
    }

    const sp = shape.current;
    if (sp) {
      const p = toDoc(e);
      let { x, y } = p;
      if (e.shiftKey) {
        const c =
          sp.tool === "line"
            ? constrainAngle(sp.x0, sp.y0, x, y)
            : constrainSquare(sp.x0, sp.y0, x, y);
        x = c.x1;
        y = c.y1;
      }
      sp.x1 = x;
      sp.y1 = y;
      requestRender();
      return;
    }

    if (stroke.current && (stroke.current.tool === "pencil" || stroke.current.tool === "brush" || stroke.current.tool === "eraser")) {
      // Coalesced: o SO agrupa amostras entre frames; sem elas o traço rápido
      // vira linha de pontos ligados por retas compridas.
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
      for (const ev of events) {
        const p = toDoc(ev);
        strokeSegment({ x: p.x, y: p.y, pressure: ev.pressure });
      }
      return;
    }

    requestRender(); // cursor de pincel acompanha
  }

  function onPointerUp(e: React.PointerEvent) {
    if (panning.current) {
      panning.current = null;
      return;
    }
    if (maskDrag.current) {
      const d = maskDrag.current;
      maskDrag.current = null;
      d.brush.endStroke();
      return;
    }
    if (marquee.current || selDrag.current) {
      marquee.current = null;
      selDrag.current = null;
      return;
    }

    const sp = shape.current;
    const st = stroke.current;

    if (sp && st) {
      // Forma: agora sim desenha NA CAMADA (o arrasto era só preview).
      const ctx = layerCtx(st.layerId);
      const tools = useTools.getState();
      ctx.save();
      drawShapeOnLayer(ctx, sp, st.color, tools.size, tools.shapeMode, useTools.getState().secondary);
      ctx.restore();
      const pad = tools.size;
      const r = unionRect(
        { x: Math.min(sp.x0, sp.x1) - pad, y: Math.min(sp.y0, sp.y1) - pad, w: Math.abs(sp.x1 - sp.x0) + 2 * pad, h: Math.abs(sp.y1 - sp.y0) + 2 * pad },
        null,
      );
      commitDirtyRect(st.layerId, st.temp, r, sp.tool);
      useTools.getState().noteUsed(st.color);
      shape.current = null;
      stroke.current = null;
      requestRender();
      return;
    }

    if (st) {
      const bbox = strokeBbox(st.points, st.tool === "pencil" ? useTools.getState().size : st.radius);
      commitDirtyRect(st.layerId, st.temp, bbox, st.tool);
      if (st.tool !== "eraser") useTools.getState().noteUsed(st.color);
      stroke.current = null;
    }
    void e;
  }

  function drawShapeOnLayer(
    ctx: CanvasRenderingContext2D,
    sp: ShapePreview,
    primary: Rgba,
    size: number,
    mode: "stroke" | "fill" | "both",
    secondary: Rgba,
  ) {
    ctx.lineWidth = size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = rgbaToCss(primary);
    ctx.fillStyle = rgbaToCss(mode === "fill" ? primary : secondary);
    if (sp.tool === "line") {
      ctx.beginPath();
      ctx.moveTo(sp.x0 + 0.5, sp.y0 + 0.5);
      ctx.lineTo(sp.x1 + 0.5, sp.y1 + 0.5);
      ctx.stroke();
      return;
    }
    const r = normRect(sp.x0, sp.y0, sp.x1, sp.y1);
    ctx.beginPath();
    if (sp.tool === "rect") ctx.rect(r.x + 0.5, r.y + 0.5, r.w, r.h);
    else ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
    if (mode !== "stroke") ctx.fill();
    if (mode !== "fill") ctx.stroke();
  }

  function pickColor(x: number, y: number, toSecondary: boolean) {
    const s = useDoc.getState();
    if (x < 0 || y < 0 || x >= s.width || y >= s.height) return;
    // Conta-gotas lê o COMPOSTO (o que o olho vê), não a camada ativa.
    const flat = document.createElement("canvas");
    flat.width = s.width;
    flat.height = s.height;
    const fctx = flat.getContext("2d", { willReadFrequently: true })!;
    compositeInto(fctx, s.layers);
    const d = fctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
    const c: Rgba = { r: d[0], g: d[1], b: d[2], a: d[3] };
    if (toSecondary) useTools.getState().setSecondary(c);
    else useTools.getState().setPrimary(c);
  }

  // ── zoom ──────────────────────────────────────────────────────────────────

  function onWheel(e: React.WheelEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const v = view.current;
    const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    const scale = Math.min(32, Math.max(0.05, v.scale * factor));
    // Zoom ancorado no cursor: o ponto do doc sob o mouse não se move.
    const dx = (mx - v.ox) / v.scale;
    const dy = (my - v.oy) / v.scale;
    view.current = { scale, ox: mx - dx * scale, oy: my - dy * scale };
    requestRender();
  }

  // Botões de zoom do App (ajustar / 100%) chegam por evento custom — o view
  // mora num ref daqui; expor setter pelo store só pra isso seria cerimônia.
  useEffect(() => {
    const onZoom = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      const host = hostRef.current;
      const s = useDoc.getState();
      if (!host || !s.open) return;
      if (detail === "fit") {
        fitView(host.clientWidth, host.clientHeight, s.width, s.height);
      } else if (detail === "100") {
        view.current = {
          scale: 1,
          ox: (host.clientWidth - s.width) / 2,
          oy: (host.clientHeight - s.height) / 2,
        };
      }
      requestRender();
    };
    window.addEventListener("localpaint:zoom", onZoom);
    return () => window.removeEventListener("localpaint:zoom", onZoom);
  }, []);

  // Espaço = pan (padrão universal de editor de imagem).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement)) {
        spaceDown.current = true;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceDown.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  return (
    <div ref={hostRef} className="stage">
      <canvas
        ref={canvasRef}
        className="stage-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          mouse.current = null;
          requestRender();
        }}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
      <RefineBar />
      <ObjMaskBar />
    </div>
  );
}

/** Zoom controlado de fora (botões do App). */
export function requestZoom(kind: "fit" | "100") {
  window.dispatchEvent(new CustomEvent("localpaint:zoom", { detail: kind }));
}
