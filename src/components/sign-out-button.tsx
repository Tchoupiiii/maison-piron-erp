import { signOut } from "@/actions/session";

export function SignOutButton() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="w-full rounded-pill px-[10px] py-1.5 text-left text-[13px] text-mid-gray transition-colors hover:bg-[#f0f0f0] hover:text-ink"
      >
        Se déconnecter
      </button>
    </form>
  );
}
