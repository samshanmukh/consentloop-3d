import type { Metadata } from "next";
import { ConsentLoopDemo } from "./components/ConsentLoopDemo";

export const metadata: Metadata = {
  title: "Patient consent journey",
  description:
    "A synthetic interactive informed-consent demo with 3D anatomy, option comparison, recovery planning, cost clarity, and teach-back.",
};

export default function Home() {
  return <ConsentLoopDemo />;
}

