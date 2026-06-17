import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Nav } from "@/components/Nav";
import { FlowFeed } from "@/components/FlowFeed";

export default async function FlowsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <div className="page-shell">
      <Nav />
      <main className="page-main">
        <div className="page-header">
          <h1 className="page-title">FLOW FEED</h1>
          <span className="badge-live">
            <span className="badge-live-dot" />
            Live
          </span>
        </div>
        <FlowFeed />
      </main>
    </div>
  );
}
