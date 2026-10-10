import type { Metadata } from "next";
import { InstrumentLibrary } from "@/features/instruments/InstrumentLibrary";

export const metadata: Metadata = { title: "Instruments" };

export default function InstrumentsPage() {
  return <InstrumentLibrary />;
}
