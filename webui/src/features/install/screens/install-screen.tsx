import { InstallPhoneIllustration } from "@/components/illustrations/install-phone-illustration"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ShareIcon, SidebarMenuIcon } from "@/components/icons"
import type { ReactNode } from "react"
import { siAndroid, siApple, siGooglechrome, siSafari } from "simple-icons"


type InstallSectionProps = {
  icon: {
    hex: string
    path: string
    title: string
  }
  title: string
  steps: ReactNode[]
}


/**
 * Renders a small inline icon used inside the install instructions.
 */
function InstructionIcon({
  children,
}: {
  children: ReactNode
}) {
  return (
    <span className="mx-1 inline-flex size-4 translate-y-[2px] items-center justify-center text-foreground">
      {children}
    </span>
  )
}


/**
 * Renders a small inline brand mark inside an instruction line.
 */
function BrandIcon({
  icon,
}: {
  icon: InstallSectionProps["icon"]
}) {
  return (
    <span className="mx-1 inline-flex size-4 translate-y-[2px] items-center justify-center text-foreground">
      <svg viewBox="0 0 24 24" className="size-3.5" fill="none" aria-hidden="true">
        <path d={icon.path} fill="currentColor" />
      </svg>
    </span>
  )
}


/**
 * Renders a branded platform icon from a Simple Icons glyph.
 */
function PlatformIcon({
  icon,
}: {
  icon: InstallSectionProps["icon"]
}) {
  return (
    <div
      aria-hidden="true"
      className="mb-3 flex size-12 items-center justify-center rounded-2xl border bg-card/80 text-muted-foreground shadow-sm"
    >
      <svg viewBox="0 0 24 24" className="size-6" fill="none">
        <title>{icon.title}</title>
        <path d={icon.path} fill="currentColor" />
      </svg>
    </div>
  )
}


/**
 * Renders one platform section with concise install steps.
 */
function InstallSection({ icon, title, steps }: InstallSectionProps) {
  return (
    <Card>
      <CardHeader>
        <PlatformIcon icon={icon} />
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-sm text-muted-foreground">
          {steps.map((step, index) => (
            <li key={`${title}-${index}`} className="flex items-start gap-2">
              <span className="mt-1 size-1.5 shrink-0 rounded-full bg-foreground/70" />
              <span>{step}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}


/**
 * Explains how to install Dim0 as a PWA on mobile devices.
 */
export function InstallScreen() {
  return (
    <div className="absolute inset-0 overflow-y-auto scrollbar-thin">
      <div className="mx-auto w-full max-w-5xl px-6 py-20 space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Install Dim0</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Add Dim0 to your home screen to use it like an app on mobile.
          </p>
        </div>

        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          <div className="hidden justify-center lg:sticky lg:top-8 lg:flex">
            <InstallPhoneIllustration
              aria-hidden="true"
              className="max-w-[280px] drop-shadow-[0_24px_48px_rgba(15,23,42,0.12)] dark:drop-shadow-[0_24px_48px_rgba(0,0,0,0.35)]"
            />
          </div>

          <div className="grid gap-6">
            <InstallSection
              icon={siApple}
              title="iPhone & iPad"
              steps={[
                <>
                  Open{" "}
                  <a
                    href="https://app.dim0.net"
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-foreground underline underline-offset-4"
                  >
                    app.dim0.net
                  </a>{" "}
                  in <strong>Safari</strong>
                  <BrandIcon icon={siSafari} />
                  .
                </>,
                <>
                  Tap <strong>Share</strong>
                  <InstructionIcon>
                    <ShareIcon className="size-3.5" strokeWidth={2} />
                  </InstructionIcon>
                  .
                </>,
                <>
                  Choose <strong>Add to Home Screen</strong>.
                </>,
                <>
                  Tap <strong>Add</strong>.
                </>,
              ]}
            />

            <InstallSection
              icon={siAndroid}
              title="Android"
              steps={[
                <>
                  Open{" "}
                  <a
                    href="https://app.dim0.net"
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-foreground underline underline-offset-4"
                  >
                    app.dim0.net
                  </a>{" "}
                  in <strong>Chrome</strong>
                  <BrandIcon icon={siGooglechrome} />
                  .
                </>,
                <>
                  Tap the browser <strong>menu</strong>
                  <InstructionIcon>
                    <SidebarMenuIcon className="size-3.5" strokeWidth={2} />
                  </InstructionIcon>
                  .
                </>,
                <>
                  Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.
                </>,
                <>
                  Tap <strong>Install</strong>.
                </>,
              ]}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
