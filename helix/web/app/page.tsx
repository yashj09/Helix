import { Hero } from "@/app/components/hero";
import { Explainer } from "@/app/components/explainer";
import { Demo } from "@/app/components/demo";
import { HowItWorks } from "@/app/components/how-it-works";
import { WhyNow } from "@/app/components/why-now";
import { Footer } from "@/app/components/footer";

export default function Page() {
  return (
    <main className="mx-auto max-w-6xl px-6 md:px-12">
      <Hero />
      <Explainer />
      <Demo />
      <HowItWorks />
      <WhyNow />
      <Footer />
    </main>
  );
}
