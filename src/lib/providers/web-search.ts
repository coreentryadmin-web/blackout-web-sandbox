import { trackedFetch } from "@/lib/api-tracked-fetch";

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export function webSearchConfigured(): boolean {
  return Boolean(
    process.env.TAVILY_API_KEY?.trim() ||
      process.env.SERPER_API_KEY?.trim() ||
      process.env.BRAVE_SEARCH_API_KEY?.trim()
  );
}

/** Web search fallback for catalysts / macro / breaking news not in market APIs. */
export async function fetchWebSearch(query: string, limit = 6): Promise<WebSearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  const tavily = process.env.TAVILY_API_KEY?.trim();
  if (tavily) {
    const res = await trackedFetch("web_search", "/search", "https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: tavily,
        query: q,
        search_depth: "advanced",
        max_results: Math.min(limit, 10),
        include_answer: false,
      }),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    return (data.results ?? []).map((r) => ({
      title: String(r.title ?? ""),
      url: String(r.url ?? ""),
      snippet: String(r.content ?? "").slice(0, 320),
    }));
  }

  const serper = process.env.SERPER_API_KEY?.trim();
  if (serper) {
    const res = await trackedFetch("web_search", "/search", "https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": serper,
      },
      body: JSON.stringify({ q, num: Math.min(limit, 10) }),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      organic?: Array<{ title?: string; link?: string; snippet?: string }>;
    };
    return (data.organic ?? []).map((r) => ({
      title: String(r.title ?? ""),
      url: String(r.link ?? ""),
      snippet: String(r.snippet ?? ""),
    }));
  }

  const brave = process.env.BRAVE_SEARCH_API_KEY?.trim();
  if (brave) {
    const qs = new URLSearchParams({ q, count: String(Math.min(limit, 10)) });
    const res = await trackedFetch(
      "web_search",
      "/res/v1/web/search",
      `https://api.search.brave.com/res/v1/web/search?${qs}`,
      {
        headers: { Accept: "application/json", "X-Subscription-Token": brave },
        cache: "no-store",
      }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
    };
    return (data.web?.results ?? []).map((r) => ({
      title: String(r.title ?? ""),
      url: String(r.url ?? ""),
      snippet: String(r.description ?? ""),
    }));
  }

  return [];
}
