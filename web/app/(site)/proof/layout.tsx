import { ProofNav } from "@/components/site/ProofNav";

export default function ProofLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ProofNav />
      {children}
    </>
  );
}
