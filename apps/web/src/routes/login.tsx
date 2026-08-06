import { useState } from "react"
import { Loader2, Lock } from "lucide-react"
import { useNavigate } from "react-router-dom"

import { signIn, signUp } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

type Mode = "sign-in" | "register"

/**
 * Auth screen (ADR-0002). Sign-in for existing users; register is invite-only
 * (ADR-0011) — a non-allowlisted email is rejected by the API and surfaced here.
 * On success better-auth sets the httpOnly session cookie and we head to "/".
 */
export function LoginScreen() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>("sign-in")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const registering = mode === "register"

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    const { error } = registering
      ? await signUp.email({ name, email, password })
      : await signIn.email({ email, password })
    setPending(false)

    if (error) {
      setError(error.message ?? "Something went wrong. Please try again.")
      return
    }
    navigate("/app", { replace: true })
  }

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-6">
      <div className="w-full max-w-[400px]">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-[13px] bg-primary text-xl font-extrabold text-primary-foreground">
            R
          </div>
          <div>
            <h1 className="text-[22px] font-bold tracking-tight">
              {registering ? "Create your account" : "Welcome back"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {registering
                ? "Alex is invite-only while in preview."
                : "Sign in to your workspace."}
            </p>
          </div>
        </div>

        <Card>
          <CardHeader className="sr-only">
            <CardTitle>{registering ? "Register" : "Sign in"}</CardTitle>
            <CardDescription>Access your Alex workspace</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="flex flex-col gap-5">
              {registering && (
                <Field>
                  <FieldLabel htmlFor="name">Name</FieldLabel>
                  <Input
                    id="name"
                    name="name"
                    autoComplete="name"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-10"
                  />
                </Field>
              )}

              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-10"
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete={
                    registering ? "new-password" : "current-password"
                  }
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-10"
                />
              </Field>

              {error && (
                <FieldError role="alert" className="-mt-1">
                  {error}
                </FieldError>
              )}

              <Button
                type="submit"
                disabled={pending}
                className="mt-1 h-10 w-full rounded-[10px]"
              >
                {pending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Lock data-icon="inline-start" />
                )}
                {registering ? "Create account" : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-5 text-center text-sm text-muted-foreground">
          {registering ? (
            <>
              Already have an account?{" "}
              <button
                type="button"
                className="font-medium text-primary hover:underline"
                onClick={() => switchMode("sign-in")}
              >
                Sign in
              </button>
            </>
          ) : (
            <>
              Have an invite?{" "}
              <button
                type="button"
                className="font-medium text-primary hover:underline"
                onClick={() => switchMode("register")}
              >
                Create an account
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
