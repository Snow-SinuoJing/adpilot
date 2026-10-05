"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** 全站唯一品牌头：场记板字形 + 字标 + 全局导航（开机 / 道具间 / 往期广告片）。 */
export function BrandBar({
  right,
  current,
}: {
  /** 项目页等需要在导航右侧追加的控件（状态、停机按钮等）。 */
  right?: React.ReactNode;
  /** 当前高亮项；项目页没有对应导航项时传 null。 */
  current?: "home" | "assets" | "archive" | null;
}) {
  const pathname = usePathname();
  const isHome = current === "home" || (current === undefined && pathname === "/");
  const isAssets = current === "assets" || (current === undefined && pathname.startsWith("/assets"));
  const isArchive = current === "archive" || (current === undefined && pathname.startsWith("/archive"));

  const link = (href: string, label: string, active: boolean) => (
    <Link
      key={href}
      href={href}
      className={`pb-0.5 text-xs font-bold tracking-[0.16em] transition-colors ${
        active ? "border-b-2 border-orange text-orange" : "border-b-2 border-transparent hover:border-orange hover:text-orange"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <header className="sticky top-0 z-40 flex flex-wrap items-center gap-x-6 gap-y-2 border-b-2 border-ink bg-paper px-5 py-3 md:px-10">
      <Link href="/" className="flex items-center gap-2.5">
        <span className="logo-glyph"><i />A</span>
        <span className="text-[19px] font-black">AdPilot</span>
        <span className="hidden border-l border-ink/25 pl-2.5 text-[10.5px] tracking-[0.2em] text-grey sm:inline">
          自修复智能体广告工作室
        </span>
      </Link>
      <nav className="flex items-center gap-5 md:gap-6">
        {link("/", "开机", isHome)}
        {link("/assets", "道具间", isAssets)}
        {link("/archive", "往期广告片", isArchive)}
      </nav>
      <div className="ml-auto flex items-center gap-2.5">
        {right}
        <Link
          href="/"
          className="bg-ink px-4 py-2 text-xs font-bold tracking-[0.12em] text-paper transition-colors hover:bg-orange"
        >
          ＋ 新广告开机
        </Link>
      </div>
    </header>
  );
}
