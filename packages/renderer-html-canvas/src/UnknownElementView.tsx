/**
 * 占位卡（查看器自有）：画板里出现查看器画不了的元素时显示，不让整块画板白屏。
 * - unknown-type：查看器尚未接入的元素类型，提示查看器需更新
 * - invalid：已知类型但数据不符合 G-canvas 格式，写明第一条校验错误
 * 定位 wrapper 由 ElementLayer 统一加。
 */
export function UnknownElementView({
  kind,
  type,
  reason,
  w,
  h,
}: {
  kind: 'unknown-type' | 'invalid'
  type: string
  reason?: string
  w: number
  h: number
}) {
  return (
    <div className={'hc-unknown-el' + (kind === 'invalid' ? ' is-invalid' : '')} style={{ width: w, height: h }}>
      <span className="hc-unknown-el-title">{kind === 'invalid' ? '无法显示的元素' : '暂不支持的元素'}</span>
      <code className="hc-unknown-el-type">{type}</code>
      <span className="hc-unknown-el-hint">
        {kind === 'invalid' ? reason : '查看器需更新到与 G-canvas 同步的版本才能显示'}
      </span>
    </div>
  )
}
