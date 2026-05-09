import * as React from "react"
import { useMutation } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"

import { resetPassword } from "@/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Loader2Icon, LockIcon } from "@/components/icons"
import { PasswordInput } from "../components/password-input"
import { PasswordStrengthMeter } from "../components/password-strength-meter"
import { getPasswordStrength } from "../lib/password-strength"


/** Renders the reset-password screen and posts a new password against the URL token. */
export function ResetPasswordPage() {
  const navigate = useNavigate()
  const token = React.useMemo(
    () => new URLSearchParams(window.location.search).get("token") ?? "",
    [],
  )
  const [password, setPassword] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [formError, setFormError] = React.useState<string | null>(null)
  const passwordStrength = React.useMemo(() => getPasswordStrength(password), [password])
  const passwordsMatch = password.length > 0 && password === confirm
  const canSubmit = passwordStrength.isValid && passwordsMatch && token.length > 0

  const mut = useMutation({
    mutationFn: () => resetPassword(token, password),
    onSuccess: () => {
      toast.success("Password reset. Please sign in with your new password.")
      navigate({ to: "/signin", replace: true })
    },
  })

  const tokenError = !token

  return (
    <div className="w-full max-w-md mx-auto">
      <Card className="bg-card text-card-foreground border border-border shadow-xl">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Reset your password</CardTitle>
          <CardDescription className="text-muted-foreground">
            Choose a new password for your account.
          </CardDescription>
        </CardHeader>

        <CardContent>
          {tokenError ? (
            <div className="space-y-4">
              <p className="text-sm text-destructive">
                This reset link is missing a token. Please request a new password reset email.
              </p>
              <Link
                to="/forgot-password"
                className="block w-full text-center text-sm font-medium underline underline-offset-2"
              >
                Request a new reset link
              </Link>
            </div>
          ) : (
            <form
              className="space-y-5"
              onSubmit={e => {
                e.preventDefault()
                if (!passwordStrength.isValid) {
                  setFormError("Please choose a stronger password before continuing.")
                  return
                }
                if (!passwordsMatch) {
                  setFormError("Passwords do not match.")
                  return
                }
                setFormError(null)
                mut.mutate()
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="password">New password</Label>
                <div className="relative">
                  <PasswordInput
                    id="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    autoFocus
                    className="pl-9 pr-9"
                  />
                  <LockIcon className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" strokeWidth={2} />
                </div>
                <PasswordStrengthMeter password={password} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm password</Label>
                <div className="relative">
                  <PasswordInput
                    id="confirm"
                    placeholder="••••••••"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    required
                    autoComplete="new-password"
                    className="pl-9 pr-9"
                  />
                  <LockIcon className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" strokeWidth={2} />
                </div>
                {confirm.length > 0 && !passwordsMatch ? (
                  <p className="text-xs text-destructive">Passwords do not match.</p>
                ) : null}
              </div>

              {formError ? (
                <p className="text-sm text-destructive">{formError}</p>
              ) : null}

              {mut.isError ? (
                <p className="text-sm text-destructive">
                  {(mut.error as Error).message || "Unable to reset password"}
                </p>
              ) : null}

              <Button type="submit" className="w-full" disabled={mut.isPending || !canSubmit}>
                {mut.isPending ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2Icon className="h-4 w-4 animate-spin" />
                    Resetting…
                  </span>
                ) : (
                  "Reset password"
                )}
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                Link expired or invalid?{" "}
                <Link to="/forgot-password" className="font-medium underline">
                  Request a new one
                </Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
