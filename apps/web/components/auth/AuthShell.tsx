import type { ReactNode } from "react";
import { AuthPage } from "../ui/auth-page";

export function AuthShell({
  children,
  title,
  subtitle,
}: {
  children: ReactNode;
  title: string;
  subtitle: string;
}) {
	return <AuthPage title={title} subtitle={subtitle}>{children}</AuthPage>;
}
