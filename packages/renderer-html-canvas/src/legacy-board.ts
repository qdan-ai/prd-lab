/**
 * 旧格式兼容（查看器自有，加载 canvas.json 后、渲染前执行；逐字件不感知）
 *
 * G-canvas 的箭头曾以两端点 x1/y1/x2/y2（+ from/to）存储，现为 points[]。预览站上可能存有
 * 旧格式快照，这里只做这一种确定的转换：
 *   arrow 元素有有限数值 x1/y1/x2/y2 且没有 points → points = [{x:x1,y:y1},{x:x2,y:y2}]，
 *   删除 x1/y1/x2/y2/from/to，其余字段（label、样式等）原样保留。
 * 不做其它旧格式猜测；转换后仍不合规的元素照常由 known-elements 显示为占位卡。
 */
import type { BoardData } from "./types";

const LEGACY_ARROW_FIELDS = ["x1", "y1", "x2", "y2", "from", "to"] as const;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function migrateLegacyBoard(board: BoardData): BoardData {
  let changed = false;
  const elements = (board.elements as unknown[]).map((el) => {
    const migrated = migrateLegacyArrow(el);
    if (migrated !== el) changed = true;
    return migrated;
  });
  return changed ? { ...board, elements: elements as BoardData["elements"] } : board;
}

function migrateLegacyArrow(el: unknown): unknown {
  if (typeof el !== "object" || el === null) return el;
  const e = el as Record<string, unknown>;
  if (e["type"] !== "arrow" || e["points"] !== undefined) return el;
  const { x1, y1, x2, y2 } = e;
  if (!finite(x1) || !finite(y1) || !finite(x2) || !finite(y2)) return el;
  const next: Record<string, unknown> = { ...e };
  for (const f of LEGACY_ARROW_FIELDS) delete next[f];
  next["points"] = [
    { x: x1, y: y1 },
    { x: x2, y: y2 },
  ];
  return next;
}
