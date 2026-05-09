import * as React from "react"
import { useMutation } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"

import { forgotPassword } from "@/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2Icon, MailIcon } from "@/components/icons"


/** Renders the forgot-password screen and submits a reset-link request. */
export function ForgotPasswordPage() {
  const [email, setEmail] = React.useState("")

  const mut = useMutation({
    mutationFn: () => forgotPassword(email),
  })

  const submitted = mut.isSuccess

  return (
    <div className="w-full max-w-md mx-auto">
      <Card className="bg-card text-card-foreground border border-border shadow-xl">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Forgot your password?</CardTitle>
          <CardDescription className="text-muted-foreground">
            Enter your email and we'll send you a link to reset it.
          </CardDescription>
        </CardHeader>

        <CardContent>
          {submitted ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                If an account exists for <span className="font-medium text-foreground">{email}</span>,
                we've sent a password reset link to that address. Check your inbox and spam folder.
              </p>
              <Link
                to="/signin"
                className="block w-full text-center text-sm font-medium underline underline-offset-2"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <form
              className="space-y-5"
              onSubmit={e => {
                e.preventDefault()
                mut.mutate()
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    autoFocus
                    className="pl-9"
                  />
                  <MailIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" strokeWidth={2} />
                </div>
              </div>

              {mut.isError ? (
                <p className="text-sm text-destructive">
                  {(mut.error as Error).message || "Unable to send reset link"}
                </p>
              ) : null}

              <Button type="submit" className="w-full" disabled={mut.isPending}>
                {mut.isPending ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2Icon className="h-4 w-4 animate-spin" />
                    Sending…
                  </span>
                ) : (
                  "Send reset link"
                )}
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                Remembered it?{" "}
                <Link to="/signin" className="font-medium underline">
                  Back to sign in
                </Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
