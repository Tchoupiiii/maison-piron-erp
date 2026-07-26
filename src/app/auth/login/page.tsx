import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/actions/activity";
import { buttonPrimary, inputClass } from "@/components/ui";
import { MAISON } from "@/lib/constants";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  async function signIn(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const identifier = String(formData.get("identifiant")).trim();
    const target = String(formData.get("next") || "/dashboard");

    // Un employé de boutique n'a pas d'adresse professionnelle : il se connecte
    // avec son identifiant, que la base traduit en adresse technique interne.
    // Une saisie inconnue ne renvoie rien et échoue comme un mot de passe faux.
    let email = identifier;
    if (!identifier.includes("@")) {
      const { data } = await supabase.rpc("auth_email_for_username", {
        username_param: identifier,
      });
      if (!data) redirect(`/auth/login?error=1&next=${encodeURIComponent(target)}`);
      email = data;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password: String(formData.get("password")),
    });

    if (signInError) {
      redirect(`/auth/login?error=1&next=${encodeURIComponent(target)}`);
    }

    // La session existe : la base peut estampiller l'auteur et l'IP.
    await logActivity({ supabase }, { action: "connexion", summary: "Connexion à l'ERP" });

    redirect(target);
  }

  return (
    <main className="grid min-h-screen place-items-center bg-canvas p-6">
      <form
        action={signIn}
        className="flex w-full max-w-sm flex-col gap-4 rounded-card border border-hairline bg-paper p-5 shadow-card"
      >
        <div className="flex flex-col gap-1">
          <span className="text-caption uppercase tracking-[0.6px] text-mid-gray">
            {MAISON.legalName}
          </span>
          <h1 className="text-heading-sm font-semibold">Connexion boutique</h1>
        </div>

        <input type="hidden" name="next" value={next ?? "/dashboard"} />

        <label className="flex flex-col gap-1">
          <span className="text-[13px] text-mid-gray">Identifiant</span>
          <input
            name="identifiant"
            type="text"
            required
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[13px] text-mid-gray">Mot de passe</span>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className={inputClass}
          />
        </label>

        {error && (
          <p className="text-caption text-ember">
            Identifiants refusés. Vérifiez l&apos;identifiant et le mot de passe.
          </p>
        )}

        <button type="submit" className={buttonPrimary}>
          Entrer
        </button>
      </form>
    </main>
  );
}
