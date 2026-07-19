/** Ícones SVG centrais (padrão da suíte desde o LocalVideo).
 *
 *  Nunca glifo de texto: o Segoe UI do WebView2 não tem vários símbolos
 *  (U+25B6 ▶ etc.) e o botão fica MUDO sem erro nenhum — lição paga. SVG
 *  inline com `currentColor` herda a cor do botão e escala nítido.
 */

export type IconName =
  | "pencil"
  | "brush"
  | "eraser"
  | "fill"
  | "eyedropper"
  | "line"
  | "rect"
  | "ellipse"
  | "file"
  | "folder"
  | "save"
  | "export"
  | "undo"
  | "redo"
  | "settings"
  | "plus"
  | "trash"
  | "copy"
  | "up"
  | "down"
  | "eye"
  | "eyeOff"
  | "swap"
  | "fit"
  | "sliders"
  | "select"
  | "crop";

const PATHS: Record<IconName, { d: string; fill?: boolean }> = {
  pencil: { d: "M3 21l1-4L16 5l3 3L7 20l-4 1zM14.5 6.5l3 3" },
  brush: { d: "M14 3l7 7-8 8c-2 2-5 2-6-1s1-4-1-5l8-9zM5 21c1.5 0 3-1 3-3" },
  eraser: { d: "M7 20h10M5 15l8-8 6 6-5 5H9l-4-3zM11 9l6 6" },
  fill: { d: "M12 3l7 7-7 7-7-7 7-7zM5 10h14M19 15c1.2 1.6 2 2.8 2 4a2 2 0 1 1-4 0c0-1.2.8-2.4 2-4z" },
  eyedropper: { d: "M3 21l1-4 9-9 3 3-9 9-4 1zM13 5l3-3 3 3-3 3M12 6l3 3" },
  line: { d: "M4 20L20 4" },
  rect: { d: "M4 6h16v12H4z" },
  ellipse: { d: "M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z" },
  file: { d: "M6 3h8l4 4v14H6V3zM14 3v4h4" },
  folder: { d: "M3 6h6l2 2h10v11H3V6z" },
  save: { d: "M5 3h11l3 3v15H5V3zM8 3v5h7V3M8 13h8v8H8v-8z" },
  export: { d: "M12 3v12M7 8l5-5 5 5M4 15v6h16v-6" },
  undo: { d: "M8 5L3 10l5 5M3 10h11a6 6 0 0 1 6 6v3" },
  redo: { d: "M16 5l5 5-5 5M21 10H10a6 6 0 0 0-6 6v3" },
  settings: {
    d: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM12 2l1 3.1 3.2-1 1.7 2.9 3.1 1v3.4l-2.6 2 .1 3.4-3.1 1.4-2.4-2.3-2.4 2.3-3.1-1.4.1-3.4-2.6-2V8l3.1-1 1.7-2.9 3.2 1L12 2z",
  },
  plus: { d: "M12 5v14M5 12h14" },
  trash: { d: "M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6" },
  copy: { d: "M9 9h11v11H9zM5 15H4V4h11v1" },
  up: { d: "M12 19V5M5 12l7-7 7 7" },
  down: { d: "M12 5v14M5 12l7 7 7-7" },
  eye: { d: "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" },
  eyeOff: { d: "M4 4l16 16M2 12s3.5-6 10-6c1.6 0 3 .3 4.3.9M22 12s-3.5 6-10 6c-1.6 0-3-.3-4.3-.9" },
  swap: { d: "M7 4v12M3 12l4 4 4-4M17 20V8M13 12l4-4 4 4" },
  fit: { d: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" },
  sliders: { d: "M5 4v6M5 14v6M12 4v10M12 18v2M19 4v2M19 10v10M3 10h4M10 14h4M17 6h4" },
  select: { d: "M5 5h3M11 5h3M17 5h2v2M19 10v3M19 16v3h-2M14 19h-3M8 19H5v-3M5 13v-3" },
  crop: { d: "M7 3v14h14M3 7h14v14" },
};

export default function Icon({ name, size = 16, label }: { name: IconName; size?: number; label?: string }) {
  const p = PATHS[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={p.fill ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={p.fill ? 0 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
    >
      <path d={p.d} />
    </svg>
  );
}
