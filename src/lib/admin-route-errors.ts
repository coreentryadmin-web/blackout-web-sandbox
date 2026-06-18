const MAX = 40;
const errors: Array<{ route: string; message: string; at: string }> = [];

export function recordAdminRouteError(route: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  errors.unshift({ route, message, at: new Date().toISOString() });
  if (errors.length > MAX) errors.length = MAX;
  console.error(`[${route}]`, error);
}

export function getAdminRouteErrors(): typeof errors {
  return [...errors];
}
