import { CtaSection } from "./_components/cta-section"
import { FaqSection } from "./_components/faq-section"
import { FeaturesSection } from "./_components/features-section"
import { Hero } from "./_components/hero"

export default function HomePage() {
  return (
    <>
      <Hero />
      <FeaturesSection />
      <FaqSection />
      <CtaSection />
    </>
  )
}
