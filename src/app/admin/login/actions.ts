"use server";

import { redirect } from "next/navigation";
import {
  checkAdminPassword,
  createAdminSession,
  deleteAdminSession,
} from "@/lib/admin/session";

export type LoginState = { error?: string } | undefined;

/**
 * Server Action invoked by the login form. Returns `{ error }` for the
 * client-side `useActionState` to display; on success it sets the cookie
 * and redirects to /admin (redirect throws, so no return value after).
 *
 * We sleep ~250ms on every attempt so a wrong password takes roughly the
 * same wall time as a right one — cheap rate-limiter against anyone
 * scripting attempts against /admin/login. Production rate limiting
 * should still be layered on if this ever becomes multi-tenant.
 */
export async function loginAction(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const password = String(formData.get("password") ?? "");
  if (!password) {
    return { error: "Şifre gerekli." };
  }

  await new Promise((resolve) => setTimeout(resolve, 250));

  if (!checkAdminPassword(password)) {
    return { error: "Şifre yanlış." };
  }

  await createAdminSession();
  redirect("/admin");
}

export async function logoutAction(): Promise<void> {
  await deleteAdminSession();
  redirect("/admin/login");
}
