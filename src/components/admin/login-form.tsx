"use client";

import { useActionState } from "react";
import { Loader2, Lock } from "lucide-react";
import { loginAction, type LoginState } from "@/app/admin/login/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(
    loginAction,
    undefined
  );

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="space-y-1">
        <CardTitle className="flex items-center gap-2 font-serif text-lg">
          <Lock className="h-4 w-4" /> Admin Giriş
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Bu panel yalnızca dev tools içindir.
        </p>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-xs">
              Şifre
            </Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              autoFocus
              aria-invalid={state?.error ? true : undefined}
            />
          </div>
          {state?.error && (
            <p className="text-xs text-destructive" role="alert">
              {state.error}
            </p>
          )}
          <Button
            type="submit"
            className="w-full"
            size="sm"
            disabled={pending}
          >
            {pending && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
            Giriş
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
