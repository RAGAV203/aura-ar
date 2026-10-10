import { PageShell } from "@/components/layout/PageShell";
import { ButtonLink } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <PageShell title="Lost in the stars">
      <p style={{ color: "var(--text-secondary)", marginBottom: "var(--space-5)" }}>This page doesn’t exist. Your creations are safe.</p>
      <ButtonLink href="/" variant="primary">
        Back to the Garden
      </ButtonLink>
    </PageShell>
  );
}
