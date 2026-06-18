/** Benzinga REST reference — Real-time News */

export const BENZINGA_NEWS_PATH = "/benzinga/v2/news";

export const BENZINGA_QUERY_PARAMS = [
  {
    name: "published",
    type: "string",
    default: "—",
    description:
      "Filter by publication time. Integer timestamp (seconds), yyyy-mm-dd, or ISO 8601 / RFC 3339 (e.g. 2024-05-28T20:27:41Z). Supports filter modifiers (.gte, .lte, etc.).",
  },
  {
    name: "channels",
    type: "string",
    default: "—",
    description: "Filter articles whose channels array contains the value. Modifiers: .any_of, .all_of, etc.",
  },
  {
    name: "tags",
    type: "string",
    default: "—",
    description: "Filter articles whose tags array contains the value.",
  },
  {
    name: "author",
    type: "string",
    default: "—",
    description: "Journalist or entity that authored the article.",
  },
  {
    name: "stocks",
    type: "string",
    default: "—",
    description: "Filter articles whose stocks array contains the value.",
  },
  {
    name: "tickers",
    type: "string",
    default: "—",
    description: "Filter articles whose tickers array contains the value. BlackOut uses tickers.any_of for single-ticker pulls.",
  },
  {
    name: "limit",
    type: "integer",
    default: "100",
    description: "Max results returned. Maximum 50,000.",
  },
  {
    name: "sort",
    type: "string",
    default: "published.desc",
    description:
      "Comma-separated sort columns with .asc or .desc suffix. Defaults to published descending.",
  },
] as const;

export const BENZINGA_RESPONSE_FIELDS = [
  { name: "next_url", type: "string", optional: true, description: "Pagination URL for the next page, if present." },
  { name: "request_id", type: "string", optional: false, description: "Server-assigned request identifier." },
  { name: "status", type: "enum (OK)", optional: false, description: "Response status." },
  {
    name: "results",
    type: "array (object)",
    optional: false,
    description: "News articles. Each object includes the fields below.",
  },
  { name: "results[].author", type: "string", optional: false, description: "Author name." },
  { name: "results[].benzinga_id", type: "integer", optional: false, description: "Benzinga record identifier." },
  { name: "results[].body", type: "string", optional: true, description: "Full article text." },
  { name: "results[].channels", type: "array (string)", optional: true, description: "Categories/topics (e.g. News, Price Target)." },
  { name: "results[].images", type: "array (string)", optional: true, description: "Associated image URLs." },
  { name: "results[].last_updated", type: "string", optional: false, description: "ISO 8601 last-updated timestamp." },
  { name: "results[].published", type: "string", optional: false, description: "ISO 8601 original publication timestamp." },
  { name: "results[].tags", type: "array (string)", optional: true, description: "Theme/content tags." },
  { name: "results[].teaser", type: "string", optional: true, description: "Short summary / lead-in." },
  { name: "results[].tickers", type: "array (string)", optional: true, description: "Stock or crypto tickers mentioned." },
  { name: "results[].title", type: "string", optional: false, description: "Headline." },
  { name: "results[].url", type: "string", optional: false, description: "Source article URL." },
] as const;
