/** Shared types for Polygon/Massive REST reference docs. */

export type RestEndpoint = {
  name: string;
  method: "GET";
  path: string;
  description: string;
  useCases: string;
  docPath?: string;
  deprecated?: boolean;
};

export type RestEndpointSection = {
  id: string;
  title: string;
  endpoints: RestEndpoint[];
};

export function restToc(sections: RestEndpointSection[]) {
  return sections.map((s) => ({
    id: s.id,
    title: s.title,
    count: s.endpoints.length,
  }));
}

export function restEndpointCount(sections: RestEndpointSection[]) {
  return sections.reduce((n, s) => n + s.endpoints.length, 0);
}
