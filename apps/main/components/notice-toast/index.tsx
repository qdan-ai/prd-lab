"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";

const NOTICE_LABELS: Record<string, string> = {
  "snapshot-archived": "该快照已被删除，已自动跳回当前快照",
};

/**
 * docs/09 §SSR：URL `?notice=...` 由 SSR 写入；客户端读取后 toast 一次，
 * 并 router.replace 清 query 防 SWR 重渲染重复 toast。
 */
export function NoticeToast({ notice }: { notice?: string }) {
  const consumedRef = useRef(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!notice || consumedRef.current) return;
    consumedRef.current = true;
    const label = NOTICE_LABELS[notice] ?? notice;
    toast(label);
    router.replace(pathname, { scroll: false });
  }, [notice, pathname, router]);

  return null;
}
