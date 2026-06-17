import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Nav } from "@/components/Nav";
import { PageBanner } from "@/components/PageBanner";
import { LargoTerminal } from "@/components/LargoTerminal";
import { IMAGES } from "@/lib/images";

export default async function TerminalPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <div className="page-shell flex flex-col">
      <Nav />
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8 flex flex-col">
        <PageBanner
          src={IMAGES.largo}
          alt="BlackOut Largo — AI trading terminal"
        />
        <div className="page-header mb-6">
          <h1 className="page-title">AI TERMINAL</h1>
          <span className="page-subtitle">Largo — BlackOut Desk</span>
        </div>
        <LargoTerminal />
      </main>
    </div>
  );
}
