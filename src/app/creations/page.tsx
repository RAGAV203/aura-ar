import type { Metadata } from "next";
import { CreationsLibrary } from "@/features/creations/CreationsLibrary";

export const metadata: Metadata = { title: "Creations" };

export default function CreationsPage() {
  return <CreationsLibrary />;
}
