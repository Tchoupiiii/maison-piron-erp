"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/actions/activity";

export async function signOut(): Promise<void> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    await logActivity({ supabase }, { action: "deconnexion", summary: "Déconnexion" });
  }

  await supabase.auth.signOut();
  redirect("/auth/login");
}
