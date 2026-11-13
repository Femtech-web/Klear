import { Footer, Header } from "@/components/site/Shell";
import { LinkButton, Section } from "@/components/ui/primitives";

/** Every unknown URL, inside the site's own frame. */
export default function NotFound() {
  return (
    <>
      <Header />
      <main id="main">
        <Section
          eyebrow="Not found"
          title="Nothing at this address."
          lede="Unlike your money under Klear, this page can go missing."
        >
          <LinkButton href="/">Back home</LinkButton>
        </Section>
      </main>
      <Footer />
    </>
  );
}
