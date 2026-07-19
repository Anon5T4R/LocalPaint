import { useSyncExternalStore } from "react";

/** i18n leve da UI (padrão da suíte, ver docs/planos/padrao-apps.md). */

export type Locale = "pt" | "en" | "es";

export const LOCALE_LABELS: Record<Locale, string> = {
  pt: "Português",
  en: "English",
  es: "Español",
};

const LOCALE_KEY = "localpaint.locale";

const pt = {
  "top.tagline": "Editor de imagem",
  "top.new": "Novo",
  "top.open": "Abrir",
  "top.save": "Salvar",
  "top.saveAs": "Salvar como…",
  "top.export": "Exportar",
  "top.undo": "Desfazer",
  "top.redo": "Refazer",
  "top.settingsTitle": "Configurações",
  "top.untitled": "Sem título",
  "top.unsavedMark": "Alterações não salvas",

  "empty.title": "Nenhuma imagem aberta",
  "empty.hint": "Crie um documento novo ou abra uma imagem — nada do que você pintar sai desta máquina.",
  "empty.new": "Novo documento",
  "empty.open": "Abrir imagem",

  "tool.select": "Selecionar (M)",
  "tool.text": "Texto (T)",
  "text.title": "Inserir texto",
  "text.placeholder": "Escreva aqui…",
  "text.size": "Tamanho",
  "text.bold": "Negrito",
  "text.apply": "Inserir",
  "text.hint": "O texto é queimado na camada ativa com a cor primária, na posição clicada. Ctrl+Enter insere.",
  "top.crop": "Recortar",
  "top.cropTip": "Recortar o documento pra seleção",
  "tool.pencil": "Lápis (P)",
  "tool.brush": "Pincel (B)",
  "tool.eraser": "Borracha (E)",
  "tool.fill": "Balde (G)",
  "tool.eyedropper": "Conta-gotas (I)",
  "tool.line": "Linha (L)",
  "tool.rect": "Retângulo (R)",
  "tool.ellipse": "Elipse (O)",
  "tool.size": "Tamanho",
  "tool.tolerance": "Tolerância",
  "tool.shapeMode": "Forma",
  "tool.shapeStroke": "Contorno",
  "tool.shapeFill": "Preenchida",
  "tool.shapeBoth": "Ambos",

  "color.primary": "Cor primária",
  "color.secondary": "Cor secundária",
  "color.swap": "Trocar cores (X)",
  "color.recent": "Recentes",

  "layers.title": "Camadas",
  "layers.background": "Fundo",
  "layers.base": "Camada",
  "layers.copySuffix": "(cópia)",
  "layers.add": "Nova camada",
  "layers.remove": "Excluir camada",
  "layers.duplicate": "Duplicar camada",
  "layers.up": "Subir",
  "layers.down": "Descer",
  "layers.opacity": "Opacidade",
  "layers.blend": "Mesclagem",
  "layers.toggleVis": "Mostrar/ocultar",
  "layers.renameHint": "Duplo clique renomeia",

  "blend.normal": "Normal",
  "blend.multiply": "Multiplicar",
  "blend.screen": "Divisão",
  "blend.overlay": "Sobrepor",
  "blend.darken": "Escurecer",
  "blend.lighten": "Clarear",
  "blend.difference": "Diferença",
  "blend.soft-light": "Luz suave",
  "blend.hard-light": "Luz forte",

  "new.title": "Novo documento",
  "new.width": "Largura",
  "new.height": "Altura",
  "new.px": "px",
  "new.background": "Fundo",
  "new.bgWhite": "Branco",
  "new.bgTransparent": "Transparente",
  "new.create": "Criar",
  "new.presets": "Predefinições",

  "export.title": "Exportar imagem",
  "export.hint": "Achata as camadas visíveis num arquivo único. Pro documento com camadas, use Salvar (.tpaint).",
  "export.jpgNote": "JPG não tem transparência — o fundo sai branco.",

  "zoom.fit": "Ajustar à janela",
  "zoom.hundred": "100%",

  "top.filters": "Filtros",
  "filters.title": "Filtros e ajustes",
  "filters.brightness": "Brilho",
  "filters.contrast": "Contraste",
  "filters.saturation": "Saturação",
  "filters.hue": "Matiz",
  "filters.blur": "Desfoque",
  "filters.sharpen": "Nitidez",
  "filters.grayscale": "Escala de cinza",
  "filters.invert": "Inverter cores",
  "filters.apply": "Aplicar",
  "filters.previewNote": "Prévia da camada ativa",

  "top.removeBg": "Remover fundo",
  "top.removeBgTip": "Remover o fundo da camada ativa (IA local)",
  "bg.title": "Remover fundo",
  "bg.checking": "Verificando o modelo…",
  "bg.needModel":
    "O recorte usa o modelo isnet-general-use (~{size} MB), baixado uma única vez. Depois disso tudo roda 100% local — nada sai da sua máquina.",
  "bg.download": "Baixar modelo",
  "bg.downloading": "Baixando o modelo… {got} de {total} MB",
  "bg.running": "Removendo o fundo…",
  "bg.done": "Fundo removido",
  "bg.err": "Falha ao remover o fundo: {err}",

  "dlg.ok": "OK",
  "dlg.cancel": "Cancelar",
  "dlg.unsavedTitle": "Alterações não salvas",
  "dlg.unsavedMsg": "Este documento tem alterações não salvas. Descartar e continuar?",

  "io.filterAll": "Imagens e LocalPaint",
  "io.filterImages": "Imagens",
  "io.badImage": "não deu pra ler esta imagem (formato não suportado ou arquivo corrompido)",
  "io.untitledFile": "sem-titulo",
  "io.saved": "Salvo em {path}",
  "io.exported": "Exportado: {path}",
  "io.reveal": "Mostrar na pasta",
  "io.openErr": "Falha ao abrir: {err}",
  "io.saveErr": "Falha ao salvar: {err}",

  "settings.title": "Configurações",
  "settings.theme": "Tema",
  "settings.themeSystem": "Sistema",
  "settings.themeLight": "Claro",
  "settings.themeDark": "Escuro",
  "settings.themeNature": "Natureza",
  "settings.themeDarkBlue": "Azul noite",
  "settings.themeCalmGreen": "Verde calmo",
  "settings.themePastelPink": "Rosa pastel",
  "settings.themePunkPrincess": "Princesa punk",
  "settings.language": "Idioma",
  "settings.about": " — editor de imagem 100% offline da suíte Local. Nada sai da sua máquina.",
} as const;

export type MessageKey = keyof typeof pt;

const en: Record<MessageKey, string> = {
  "top.tagline": "Image editor",
  "top.new": "New",
  "top.open": "Open",
  "top.save": "Save",
  "top.saveAs": "Save as…",
  "top.export": "Export",
  "top.undo": "Undo",
  "top.redo": "Redo",
  "top.settingsTitle": "Settings",
  "top.untitled": "Untitled",
  "top.unsavedMark": "Unsaved changes",

  "empty.title": "No image open",
  "empty.hint": "Create a new document or open an image — nothing you paint leaves this machine.",
  "empty.new": "New document",
  "empty.open": "Open image",

  "tool.select": "Select (M)",
  "tool.text": "Text (T)",
  "text.title": "Insert text",
  "text.placeholder": "Type here…",
  "text.size": "Size",
  "text.bold": "Bold",
  "text.apply": "Insert",
  "text.hint": "The text is burned into the active layer with the primary color, at the clicked position. Ctrl+Enter inserts.",
  "top.crop": "Crop",
  "top.cropTip": "Crop the document to the selection",
  "tool.pencil": "Pencil (P)",
  "tool.brush": "Brush (B)",
  "tool.eraser": "Eraser (E)",
  "tool.fill": "Fill bucket (G)",
  "tool.eyedropper": "Eyedropper (I)",
  "tool.line": "Line (L)",
  "tool.rect": "Rectangle (R)",
  "tool.ellipse": "Ellipse (O)",
  "tool.size": "Size",
  "tool.tolerance": "Tolerance",
  "tool.shapeMode": "Shape",
  "tool.shapeStroke": "Outline",
  "tool.shapeFill": "Filled",
  "tool.shapeBoth": "Both",

  "color.primary": "Primary color",
  "color.secondary": "Secondary color",
  "color.swap": "Swap colors (X)",
  "color.recent": "Recent",

  "layers.title": "Layers",
  "layers.background": "Background",
  "layers.base": "Layer",
  "layers.copySuffix": "(copy)",
  "layers.add": "New layer",
  "layers.remove": "Delete layer",
  "layers.duplicate": "Duplicate layer",
  "layers.up": "Move up",
  "layers.down": "Move down",
  "layers.opacity": "Opacity",
  "layers.blend": "Blend",
  "layers.toggleVis": "Show/hide",
  "layers.renameHint": "Double-click to rename",

  "blend.normal": "Normal",
  "blend.multiply": "Multiply",
  "blend.screen": "Screen",
  "blend.overlay": "Overlay",
  "blend.darken": "Darken",
  "blend.lighten": "Lighten",
  "blend.difference": "Difference",
  "blend.soft-light": "Soft light",
  "blend.hard-light": "Hard light",

  "new.title": "New document",
  "new.width": "Width",
  "new.height": "Height",
  "new.px": "px",
  "new.background": "Background",
  "new.bgWhite": "White",
  "new.bgTransparent": "Transparent",
  "new.create": "Create",
  "new.presets": "Presets",

  "export.title": "Export image",
  "export.hint": "Flattens the visible layers into a single file. For the layered document, use Save (.tpaint).",
  "export.jpgNote": "JPG has no transparency — the background comes out white.",

  "zoom.fit": "Fit to window",
  "zoom.hundred": "100%",

  "top.filters": "Filters",
  "filters.title": "Filters & adjustments",
  "filters.brightness": "Brightness",
  "filters.contrast": "Contrast",
  "filters.saturation": "Saturation",
  "filters.hue": "Hue",
  "filters.blur": "Blur",
  "filters.sharpen": "Sharpen",
  "filters.grayscale": "Grayscale",
  "filters.invert": "Invert colors",
  "filters.apply": "Apply",
  "filters.previewNote": "Active layer preview",

  "top.removeBg": "Remove background",
  "top.removeBgTip": "Remove the active layer's background (local AI)",
  "bg.title": "Remove background",
  "bg.checking": "Checking for the model…",
  "bg.needModel":
    "The cutout uses the isnet-general-use model (~{size} MB), downloaded only once. After that everything runs 100% locally — nothing leaves your machine.",
  "bg.download": "Download model",
  "bg.downloading": "Downloading the model… {got} of {total} MB",
  "bg.running": "Removing the background…",
  "bg.done": "Background removed",
  "bg.err": "Failed to remove the background: {err}",

  "dlg.ok": "OK",
  "dlg.cancel": "Cancel",
  "dlg.unsavedTitle": "Unsaved changes",
  "dlg.unsavedMsg": "This document has unsaved changes. Discard and continue?",

  "io.filterAll": "Images and LocalPaint",
  "io.filterImages": "Images",
  "io.badImage": "couldn't read this image (unsupported format or corrupted file)",
  "io.untitledFile": "untitled",
  "io.saved": "Saved to {path}",
  "io.exported": "Exported: {path}",
  "io.reveal": "Show in folder",
  "io.openErr": "Failed to open: {err}",
  "io.saveErr": "Failed to save: {err}",

  "settings.title": "Settings",
  "settings.theme": "Theme",
  "settings.themeSystem": "System",
  "settings.themeLight": "Light",
  "settings.themeDark": "Dark",
  "settings.themeNature": "Nature",
  "settings.themeDarkBlue": "Night blue",
  "settings.themeCalmGreen": "Calm green",
  "settings.themePastelPink": "Pastel pink",
  "settings.themePunkPrincess": "Punk princess",
  "settings.language": "Language",
  "settings.about": " — 100% offline image editor from the Local suite. Nothing leaves your machine.",
};

const es: Record<MessageKey, string> = {
  "top.tagline": "Editor de imágenes",
  "top.new": "Nuevo",
  "top.open": "Abrir",
  "top.save": "Guardar",
  "top.saveAs": "Guardar como…",
  "top.export": "Exportar",
  "top.undo": "Deshacer",
  "top.redo": "Rehacer",
  "top.settingsTitle": "Configuración",
  "top.untitled": "Sin título",
  "top.unsavedMark": "Cambios sin guardar",

  "empty.title": "Ninguna imagen abierta",
  "empty.hint": "Crea un documento nuevo o abre una imagen — nada de lo que pintes sale de esta máquina.",
  "empty.new": "Documento nuevo",
  "empty.open": "Abrir imagen",

  "tool.select": "Seleccionar (M)",
  "tool.text": "Texto (T)",
  "text.title": "Insertar texto",
  "text.placeholder": "Escribe aquí…",
  "text.size": "Tamaño",
  "text.bold": "Negrita",
  "text.apply": "Insertar",
  "text.hint": "El texto se quema en la capa activa con el color primario, en la posición del clic. Ctrl+Enter inserta.",
  "top.crop": "Recortar",
  "top.cropTip": "Recortar el documento a la selección",
  "tool.pencil": "Lápiz (P)",
  "tool.brush": "Pincel (B)",
  "tool.eraser": "Borrador (E)",
  "tool.fill": "Bote de pintura (G)",
  "tool.eyedropper": "Cuentagotas (I)",
  "tool.line": "Línea (L)",
  "tool.rect": "Rectángulo (R)",
  "tool.ellipse": "Elipse (O)",
  "tool.size": "Tamaño",
  "tool.tolerance": "Tolerancia",
  "tool.shapeMode": "Forma",
  "tool.shapeStroke": "Contorno",
  "tool.shapeFill": "Rellena",
  "tool.shapeBoth": "Ambos",

  "color.primary": "Color primario",
  "color.secondary": "Color secundario",
  "color.swap": "Intercambiar colores (X)",
  "color.recent": "Recientes",

  "layers.title": "Capas",
  "layers.background": "Fondo",
  "layers.base": "Capa",
  "layers.copySuffix": "(copia)",
  "layers.add": "Nueva capa",
  "layers.remove": "Eliminar capa",
  "layers.duplicate": "Duplicar capa",
  "layers.up": "Subir",
  "layers.down": "Bajar",
  "layers.opacity": "Opacidad",
  "layers.blend": "Fusión",
  "layers.toggleVis": "Mostrar/ocultar",
  "layers.renameHint": "Doble clic para renombrar",

  "blend.normal": "Normal",
  "blend.multiply": "Multiplicar",
  "blend.screen": "Trama",
  "blend.overlay": "Superponer",
  "blend.darken": "Oscurecer",
  "blend.lighten": "Aclarar",
  "blend.difference": "Diferencia",
  "blend.soft-light": "Luz suave",
  "blend.hard-light": "Luz fuerte",

  "new.title": "Documento nuevo",
  "new.width": "Ancho",
  "new.height": "Alto",
  "new.px": "px",
  "new.background": "Fondo",
  "new.bgWhite": "Blanco",
  "new.bgTransparent": "Transparente",
  "new.create": "Crear",
  "new.presets": "Preajustes",

  "export.title": "Exportar imagen",
  "export.hint": "Aplana las capas visibles en un archivo único. Para el documento con capas, usa Guardar (.tpaint).",
  "export.jpgNote": "JPG no tiene transparencia — el fondo sale blanco.",

  "zoom.fit": "Ajustar a la ventana",
  "zoom.hundred": "100%",

  "top.filters": "Filtros",
  "filters.title": "Filtros y ajustes",
  "filters.brightness": "Brillo",
  "filters.contrast": "Contraste",
  "filters.saturation": "Saturación",
  "filters.hue": "Tono",
  "filters.blur": "Desenfoque",
  "filters.sharpen": "Nitidez",
  "filters.grayscale": "Escala de grises",
  "filters.invert": "Invertir colores",
  "filters.apply": "Aplicar",
  "filters.previewNote": "Vista previa de la capa activa",

  "top.removeBg": "Quitar fondo",
  "top.removeBgTip": "Quitar el fondo de la capa activa (IA local)",
  "bg.title": "Quitar fondo",
  "bg.checking": "Verificando el modelo…",
  "bg.needModel":
    "El recorte usa el modelo isnet-general-use (~{size} MB), descargado una sola vez. Después todo corre 100% local — nada sale de tu máquina.",
  "bg.download": "Descargar modelo",
  "bg.downloading": "Descargando el modelo… {got} de {total} MB",
  "bg.running": "Quitando el fondo…",
  "bg.done": "Fondo quitado",
  "bg.err": "Error al quitar el fondo: {err}",

  "dlg.ok": "OK",
  "dlg.cancel": "Cancelar",
  "dlg.unsavedTitle": "Cambios sin guardar",
  "dlg.unsavedMsg": "Este documento tiene cambios sin guardar. ¿Descartar y continuar?",

  "io.filterAll": "Imágenes y LocalPaint",
  "io.filterImages": "Imágenes",
  "io.badImage": "no se pudo leer esta imagen (formato no soportado o archivo dañado)",
  "io.untitledFile": "sin-titulo",
  "io.saved": "Guardado en {path}",
  "io.exported": "Exportado: {path}",
  "io.reveal": "Mostrar en carpeta",
  "io.openErr": "Error al abrir: {err}",
  "io.saveErr": "Error al guardar: {err}",

  "settings.title": "Configuración",
  "settings.theme": "Tema",
  "settings.themeSystem": "Sistema",
  "settings.themeLight": "Claro",
  "settings.themeDark": "Oscuro",
  "settings.themeNature": "Naturaleza",
  "settings.themeDarkBlue": "Azul noche",
  "settings.themeCalmGreen": "Verde calma",
  "settings.themePastelPink": "Rosa pastel",
  "settings.themePunkPrincess": "Princesa punk",
  "settings.language": "Idioma",
  "settings.about": " — editor de imágenes 100% offline de la suite Local. Nada sale de tu máquina.",
};

const DICTS: Record<Locale, Record<MessageKey, string>> = { pt, en, es };

function detectLocale(): Locale {
  const lang = typeof navigator !== "undefined" ? navigator.language.toLowerCase() : "en";
  if (lang.startsWith("pt")) return "pt";
  if (lang.startsWith("es")) return "es";
  return "en";
}

function loadLocale(): Locale {
  const saved = typeof localStorage !== "undefined" ? localStorage.getItem(LOCALE_KEY) : null;
  if (saved === "pt" || saved === "en" || saved === "es") return saved;
  return detectLocale();
}

let current: Locale = loadLocale();
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return current;
}

export function setLocale(l: Locale) {
  current = l;
  if (typeof localStorage !== "undefined") localStorage.setItem(LOCALE_KEY, l);
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale);
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  let s: string = DICTS[current][key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}
