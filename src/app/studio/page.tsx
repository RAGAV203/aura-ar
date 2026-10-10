import type { Metadata } from "next";
import { Suspense } from "react";
import { StudioScreen } from "@/features/studio/StudioScreen";

export const metadata: Metadata = { title: "Studio" };

export default function StudioPage() {
  return (
    <Suspense fallback={null}>
      <StudioScreen />
    </Suspense>
  );
}
