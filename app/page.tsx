import type { Metadata } from "next";
import { ConsentLoopDemo } from "./components/ConsentLoopDemo";

export const metadata: Metadata = {
  title: "Patient consent journey",
  description:
    "A simple patient-education demo for understanding a knee diagnosis, comparing care paths, and viewing arthroscopy step by step in 3D.",
};

export default function Home() {
  return <ConsentLoopDemo />;
}
