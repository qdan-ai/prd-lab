import type { AnchorsFile } from "../types";

type Props = {
  anchors: AnchorsFile | null;
  onJumpRow: (rowId: string) => void;
};

/**
 * Anchors 列表 chip（DESIGN §7.3.4 / 决策 D10）：
 *
 * v1 简化：仅 chip 列表 + 点击触发画板 row scrollIntoView。
 * 不做基于 panzoom 实时跟随的 overlay pin（viewer 未暴露 panzoom 实例）。
 *
 * 与 BRIEF 成功标准的对齐说明：
 *   "anchors.json 中的锚点 overlay pin + 文档侧 chip 显示（只读，可点击跳转）"
 *   → v1 实际形态 = chip + scrollIntoView 跳转；overlay pin 不实时跟随
 *   → 已记入 DESIGN §15.3 与 D10
 */
export function AnchorsList(props: Props) {
  const { anchors, onJumpRow } = props;
  const list = anchors?.anchors;
  if (!Array.isArray(list) || list.length === 0) return null;

  return (
    <div className="pm-canvas-anchors">
      <div className="pm-canvas-anchors-title">锚点</div>
      <div className="pm-canvas-anchors-chips">
        {list.map((pin, idx) => {
          const key = pin.id ?? pin.rowId ?? `anchor-${idx}`;
          const rowId = pin.rowId;
          return (
            <button
              key={key}
              type="button"
              className="pm-canvas-anchors-chip"
              title={rowId ? `跳到 ${rowId}` : "锚点"}
              onClick={() => rowId && onJumpRow(rowId)}
              disabled={!rowId}
            >
              {pin.label ?? rowId ?? "锚点"}
            </button>
          );
        })}
      </div>
    </div>
  );
}
