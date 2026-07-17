/** Cron job keys from src/lib/cron-registry.ts (AWS EventBridge triggers these paths). */
import { allCronKeys } from "./cron-registry-parse.mjs";

export const ALL_CRON_KEYS = allCronKeys();
