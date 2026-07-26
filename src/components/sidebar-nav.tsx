"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SidebarNav({
  items,
}: {
  items: { href: string; label: string }[];
}) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      <span className="px-[10px] pb-1 text-caption uppercase tracking-[0.6px] text-mid-gray">
        Boutique
      </span>
      {items.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-9 items-center rounded-pill px-[10px] py-1.5 text-body transition-colors ${
              active
                ? "bg-paper font-medium text-ink shadow-[0_0_0_1px_rgba(23,23,23,0.05),0_1px_2px_rgba(0,0,0,0.06)]"
                : "text-mid-gray hover:bg-[#f0f0f0] hover:text-ink"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
