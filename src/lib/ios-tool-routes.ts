/** Primary product routes where the iOS bottom tab bar should appear. */
export const IOS_TOOL_ROUTES = [
  "/dashboard",
  "/flows",
  "/heatmap",
  "/terminal",
  "/nighthawk",
  "/grid",
] as const;

export function isIosToolRoute(path: string): boolean {
  return IOS_TOOL_ROUTES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
