import { PresentationShell } from "@/components/presentation-shell";

export default function PresentationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PresentationShell>{children}</PresentationShell>;
}
