import { useState } from "react";
import type { PmCanvasDoc } from "../../node";
import { MdViewer } from "./MdViewer";
import { ExcalidrawViewer } from "./ExcalidrawViewer";
import { DrawioViewer } from "./DrawioViewer";

type Props = {
  baseUrl: string;
  docs: PmCanvasDoc[];
};

/**
 * Docs 面板：左侧文件列表，右侧当前选中文件的 viewer。
 *
 * 选中状态：默认选第一个 doc；切换 doc 时 viewer 走 useEffect 重新加载。
 */
export function DocsPanel(props: Props) {
  const { baseUrl, docs } = props;
  const [activeIdx, setActiveIdx] = useState<number>(docs.length > 0 ? 0 : -1);

  if (docs.length === 0) {
    return (
      <div className="pm-canvas-docs-empty">
        <p>本画板未携带 docs。</p>
      </div>
    );
  }

  const active = activeIdx >= 0 && activeIdx < docs.length ? docs[activeIdx] : undefined;

  return (
    <div className="pm-canvas-docs">
      <nav className="pm-canvas-docs-list">
        {docs.map((doc, idx) => (
          <button
            key={doc.path}
            type="button"
            className={
              "pm-canvas-docs-list-item" + (idx === activeIdx ? " is-active" : "")
            }
            onClick={() => setActiveIdx(idx)}
            title={doc.path}
          >
            <span className="pm-canvas-docs-list-type">{doc.type}</span>
            <span className="pm-canvas-docs-list-name">{stripDocsPrefix(doc.path)}</span>
          </button>
        ))}
      </nav>
      <section className="pm-canvas-docs-viewer">
        {active && renderViewer(baseUrl, active)}
      </section>
    </div>
  );
}

function renderViewer(baseUrl: string, doc: PmCanvasDoc) {
  switch (doc.type) {
    case "md":
      return <MdViewer key={doc.path} baseUrl={baseUrl} docPath={doc.path} />;
    case "excalidraw":
      return <ExcalidrawViewer key={doc.path} baseUrl={baseUrl} docPath={doc.path} />;
    case "drawio":
      return <DrawioViewer key={doc.path} baseUrl={baseUrl} docPath={doc.path} />;
  }
}

function stripDocsPrefix(path: string): string {
  return path.startsWith("docs/") ? path.slice("docs/".length) : path;
}
