import type { Metadata } from "next";
import { Onboarding } from "@/features/onboarding/Onboarding";

export const metadata: Metadata = { title: "Welcome" };

export default function WelcomePage() {
  return <Onboarding />;
}
