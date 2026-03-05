import { AnimatedGridPattern } from "@crikket/ui/components/magicui/animated-grid-pattern"
import type { ReactNode } from "react"
import { LandingFooter } from "./_components/landing-footer"
import { SiteHeader } from "./_components/site-header"

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader />
      <main className="flex flex-1 flex-col">
        <div className="relative flex flex-1 flex-col bg-background pt-24 sm:pt-32">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-hidden"
          >
            <AnimatedGridPattern
              className="mask-[radial-gradient(1000px_circle_at_50%_25%,white,transparent)] inset-x-0 inset-y-[-30%] h-[200%] skew-y-12"
              duration={3}
              maxOpacity={0.15}
              numSquares={30}
              repeatDelay={1}
            />
          </div>

          <div className="relative z-10 mx-auto flex w-full max-w-[1400px] flex-col items-center space-y-34 px-0 text-center sm:px-4 md:px-8 xl:px-12">
            {children}
          </div>
          <div className="relative z-10 mt-auto">
            <LandingFooter />
          </div>
        </div>
      </main>
    </div>
  )
}
