"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/");
    }
  }

  return <button type="button" className="plan-button" disabled={busy} onClick={() => void logout()}><LogOut aria-hidden="true" />{busy ? "Signing out…" : "Log out"}</button>;
}
