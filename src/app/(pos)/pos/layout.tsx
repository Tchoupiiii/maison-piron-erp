import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MAISON } from "@/lib/constants";

/**
 * Chrome tactile du point de vente : pas de sidebar, cibles ≥44 px.
 * Même app, mêmes Server Actions que le back-office — un seul moteur de prix.
 * `print:hidden` retire la coquille à l'impression du ticket.
 */
export default async function PosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  return (
    <div className="flex min-h-screen flex-col bg-canvas print:min-h-0 print:bg-white">
      <header className="flex items-center justify-between gap-4 border-b border-hairline px-6 py-4 print:hidden">
        <div className="flex flex-col">
          <span className="text-caption uppercase tracking-[0.6px] text-mid-gray">
            {MAISON.legalName}
          </span>
          <span className="text-heading-sm font-semibold">Point de vente</span>
        </div>
        <Link
          href="/dashboard"
          className="flex min-h-11 items-center rounded-pill border border-hairline px-4 text-body font-medium"
        >
          Back-office
        </Link>
      </header>
      <main className="flex-1 p-6 print:p-0">{children}</main>
    </div>
  );
}
