"use client";

/** 停止后立刻刷新一次状态（SSE 也会推送 PROJECT_STOPPED 事件）。 */
export function requestStopRefresh(): void {
  setTimeout(() => window.location.reload(), 600);
}
