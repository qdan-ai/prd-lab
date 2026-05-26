export default function PreviewIndex() {
  return (
    <main style={{ padding: "40px", fontFamily: "system-ui" }}>
      <h1>PRD-Lab · Preview Origin</h1>
      <p>本域用于隔离渲染上传的画板内容（S0 占位）。</p>
      <p>实际预览入口：<code>/p/{"{snapshotId}"}/__entry?token=...</code></p>
    </main>
  );
}
