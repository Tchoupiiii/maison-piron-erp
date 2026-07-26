import Link from "next/link";
import type { ReactNode } from "react";

/* Primitives partagées : les écrans répétaient les mêmes valeurs Tailwind
   arbitraires. Les jetons viennent de globals.css / DESIGN-ERP.md. */

export const buttonPrimary =
  "inline-flex h-9 min-h-9 items-center justify-center rounded-pill bg-ink px-4 text-body font-medium text-surface-alt transition-opacity hover:opacity-90 disabled:opacity-40";

export const buttonGhost =
  "inline-flex h-9 min-h-9 items-center justify-center rounded-pill border border-hairline bg-transparent px-3 text-body font-medium text-ink transition-colors hover:bg-surface-alt disabled:opacity-40";

export const buttonDanger =
  "inline-flex h-9 min-h-9 items-center justify-center rounded-pill border border-ember bg-transparent px-3 text-body font-medium text-ember transition-colors hover:bg-ember hover:text-paper disabled:opacity-40";

export const inputClass =
  "h-9 w-full rounded-pill border border-hairline bg-paper px-3 text-body text-ink outline-none placeholder:text-mid-gray focus:border-ink";

export const selectClass = inputClass + " appearance-none pr-8";

export const labelClass =
  "text-caption uppercase tracking-[0.6px] text-mid-gray";

export function PageHeader({
  breadcrumb,
  title,
  aside,
  children,
}: {
  breadcrumb: string[];
  title: string;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-10 flex flex-wrap items-end justify-between gap-6 border-b border-hairline bg-canvas px-12 pb-5 pt-6">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2 text-body text-mid-gray">
          {breadcrumb.map((crumb, index) => (
            <span
              key={crumb + index}
              className={index === breadcrumb.length - 1 ? "text-ink" : undefined}
            >
              {index > 0 && <span className="mr-2 text-mid-gray">›</span>}
              {crumb}
            </span>
          ))}
        </div>
        <h1 className="text-heading font-semibold">{title}</h1>
        {children}
      </div>
      {aside && <div className="flex flex-wrap items-center gap-2">{aside}</div>}
    </header>
  );
}

export function Section({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex flex-col gap-6 px-12 pb-12 pt-6 ${className}`}>
      {children}
    </section>
  );
}

export type Stat = { label: string; value: string; sub?: string };

export function StatRow({ stats }: { stats: Stat[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-6 border-b border-hairline pb-6">
      {stats.map((stat) => (
        <div key={stat.label} className="flex flex-col gap-1">
          <span className={labelClass}>{stat.label}</span>
          <span className="tabular text-heading-lg font-medium">{stat.value}</span>
          {stat.sub && <span className="text-[13px] text-mid-gray">{stat.sub}</span>}
        </div>
      ))}
    </div>
  );
}

export function Card({
  title,
  subtitle,
  aside,
  children,
  padded = false,
}: {
  title?: string;
  subtitle?: string;
  aside?: ReactNode;
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-paper shadow-card">
      {(title || aside) && (
        <div className="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4">
          <div className="flex flex-col gap-1">
            {title && <span className="text-subheading font-medium">{title}</span>}
            {subtitle && <p className="text-[13px] text-mid-gray">{subtitle}</p>}
          </div>
          {aside}
        </div>
      )}
      <div className={padded ? "p-5" : undefined}>{children}</div>
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "solid" | "danger";
}) {
  const tones = {
    neutral: "border border-hairline bg-surface-alt text-mid-gray",
    solid: "bg-ink-soft text-surface-alt",
    danger: "border border-ember text-ember",
  };
  return (
    <span
      className={`inline-flex items-center rounded-pill px-2 py-0.5 text-caption font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-5 py-12 text-center">
      <span className="text-body font-medium">{title}</span>
      {hint && <span className="text-[13px] text-mid-gray">{hint}</span>}
    </div>
  );
}

export function Row({
  href,
  children,
}: {
  href?: string;
  children: ReactNode;
}) {
  const className =
    "grid grid-cols-[110px_1fr_auto] items-center gap-4 border-b border-canvas px-5 py-3 text-body last:border-b-0";
  if (href) {
    return (
      <Link href={href} className={`${className} hover:bg-surface-alt`}>
        {children}
      </Link>
    );
  }
  return <div className={className}>{children}</div>;
}

/** Bandeau d'information ou d'avertissement, sans couleur décorative. */
export function Notice({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "warning";
}) {
  return (
    <div
      className={`rounded-card border px-5 py-4 text-body ${
        tone === "warning"
          ? "border-ember/40 bg-paper text-ink"
          : "border-hairline bg-surface-alt text-mid-gray"
      }`}
    >
      {children}
    </div>
  );
}
