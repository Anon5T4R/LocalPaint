import Icon, { type IconName } from "./Icon";
import { t } from "../lib/i18n";
import { useTools, type Tool } from "../state/tools";

const TOOLS: { tool: Tool; icon: IconName; key: "tool.pencil" | "tool.brush" | "tool.eraser" | "tool.fill" | "tool.eyedropper" | "tool.line" | "tool.rect" | "tool.ellipse" }[] = [
  { tool: "pencil", icon: "pencil", key: "tool.pencil" },
  { tool: "brush", icon: "brush", key: "tool.brush" },
  { tool: "eraser", icon: "eraser", key: "tool.eraser" },
  { tool: "fill", icon: "fill", key: "tool.fill" },
  { tool: "eyedropper", icon: "eyedropper", key: "tool.eyedropper" },
  { tool: "line", icon: "line", key: "tool.line" },
  { tool: "rect", icon: "rect", key: "tool.rect" },
  { tool: "ellipse", icon: "ellipse", key: "tool.ellipse" },
];

/** Barra vertical de ferramentas + parâmetros da ferramenta ativa. */
export default function Toolbar() {
  const tool = useTools((s) => s.tool);
  const setTool = useTools((s) => s.setTool);
  const size = useTools((s) => s.size);
  const setSize = useTools((s) => s.setSize);
  const tolerance = useTools((s) => s.tolerance);
  const setTolerance = useTools((s) => s.setTolerance);
  const shapeMode = useTools((s) => s.shapeMode);
  const setShapeMode = useTools((s) => s.setShapeMode);

  const showsSize = tool !== "fill" && tool !== "eyedropper";
  const isShape = tool === "line" || tool === "rect" || tool === "ellipse";

  return (
    <div className="toolbar">
      <div className="tool-grid">
        {TOOLS.map((tl) => (
          <button
            key={tl.tool}
            className={`tool-btn${tool === tl.tool ? " active" : ""}`}
            title={t(tl.key)}
            onClick={() => setTool(tl.tool)}
          >
            <Icon name={tl.icon} size={18} />
          </button>
        ))}
      </div>

      {showsSize && (
        <label className="tool-param">
          <span>{t("tool.size")}</span>
          <input
            type="range"
            min={1}
            max={tool === "pencil" ? 16 : 200}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
          />
          <b>{size}</b>
        </label>
      )}

      {tool === "fill" && (
        <label className="tool-param">
          <span>{t("tool.tolerance")}</span>
          <input
            type="range"
            min={0}
            max={128}
            value={tolerance}
            onChange={(e) => setTolerance(Number(e.target.value))}
          />
          <b>{tolerance}</b>
        </label>
      )}

      {isShape && tool !== "line" && (
        <div className="tool-param">
          <span>{t("tool.shapeMode")}</span>
          <div className="segmented vertical">
            <button className={shapeMode === "stroke" ? "active" : ""} onClick={() => setShapeMode("stroke")}>
              {t("tool.shapeStroke")}
            </button>
            <button className={shapeMode === "fill" ? "active" : ""} onClick={() => setShapeMode("fill")}>
              {t("tool.shapeFill")}
            </button>
            <button className={shapeMode === "both" ? "active" : ""} onClick={() => setShapeMode("both")}>
              {t("tool.shapeBoth")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
