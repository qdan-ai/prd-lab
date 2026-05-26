import { NewProjectButton } from "./new-project-button";
import { formatRelative, greetingByHour } from "./format";

interface Props {
  userName: string;
  totalProjects: number;
  latestUploadAt: Date | null;
}

export function WorkbenchTitleBlock({ userName, totalProjects, latestUploadAt }: Props) {
  const hour = new Date().getHours();
  const greeting = greetingByHour(hour);

  const subtitle = buildSubtitle(totalProjects, latestUploadAt);

  return (
    <div className="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <h1 className="text-[30px] font-semibold tracking-tight text-ink-900 leading-tight">
          {greeting}，{userName}
        </h1>
        <p className="text-[14px] text-ink-500 mt-2 leading-relaxed">{subtitle}</p>
      </div>
      <NewProjectButton />
    </div>
  );
}

function buildSubtitle(total: number, latestUploadAt: Date | null): string {
  if (total === 0) return "今天还没有项目";
  if (!latestUploadAt) return "准备好开始今天的工作";
  return `最近一次上传在 ${formatRelative(latestUploadAt)}`;
}
