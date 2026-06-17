import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Nav } from "@/components/Nav";
import { NightHawkFeed } from "@/components/NightHawkFeed";

export default async function NightHawkPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <div className="page-shell">
      <Nav />
      <main className="page-main">
        <div className="page-header">
          <h1 className="page-title">NIGHT HAWK</h1>
          <span className="page-subtitle">2–10 DTE Swing Plays</span>
        </div>
        <NightHawkFeed />
      </main>
    </div>
  );
}
