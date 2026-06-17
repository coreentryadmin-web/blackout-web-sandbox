import { NextRequest, NextResponse } from "next/server";

const CLERK_FAPI = "https://frontend-api.clerk.dev";
const PROXY_URL =
  process.env.NEXT_PUBLIC_CLERK_PROXY_URL ?? "https://blackouttrades.com/__clerk";

async function proxyRequest(req: NextRequest, path: string[]) {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    return NextResponse.json({ error: "Missing CLERK_SECRET_KEY" }, { status: 500 });
  }

  const targetPath = path.join("/");
  const targetUrl = `${CLERK_FAPI}/${targetPath}${req.nextUrl.search}`;

  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.set("Clerk-Proxy-Url", PROXY_URL.replace(/\/$/, ""));
  headers.set("Clerk-Secret-Key", secretKey);
  headers.set(
    "X-Forwarded-For",
    req.headers.get("x-forwarded-for") ?? req.headers.get("cf-connecting-ip") ?? "127.0.0.1"
  );

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: "manual",
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer();
  }

  const response = await fetch(targetUrl, init);
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-encoding");

  return new NextResponse(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

export async function GET(req: NextRequest, { params }: { params: { path?: string[] } }) {
  return proxyRequest(req, params.path ?? []);
}

export async function POST(req: NextRequest, { params }: { params: { path?: string[] } }) {
  return proxyRequest(req, params.path ?? []);
}

export async function PUT(req: NextRequest, { params }: { params: { path?: string[] } }) {
  return proxyRequest(req, params.path ?? []);
}

export async function PATCH(req: NextRequest, { params }: { params: { path?: string[] } }) {
  return proxyRequest(req, params.path ?? []);
}

export async function DELETE(req: NextRequest, { params }: { params: { path?: string[] } }) {
  return proxyRequest(req, params.path ?? []);
}
