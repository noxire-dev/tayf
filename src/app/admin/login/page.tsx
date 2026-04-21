import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { hasAdminSession } from "@/lib/admin/session";
import { LoginForm } from "@/components/admin/login-form";

export const metadata: Metadata = {
  title: "Admin Giriş",
  // Belt-and-suspenders: robots.ts already disallows /admin, but search
  // engines occasionally honor the page-level directive faster.
  robots: { index: false, follow: false },
};

export default async function AdminLoginPage() {
  if (await hasAdminSession()) {
    redirect("/admin");
  }

  return (
    <div className="container mx-auto flex items-center justify-center px-4 py-24">
      <LoginForm />
    </div>
  );
}
