#!/usr/bin/env node
/** Quick screenshot capture — delegates to full E2E (first tab only). */
import { spawnSync } from "node:child_process";
const r = spawnSync("node", ["scripts/ios-native-ui-e2e.mjs"], { stdio: "inherit", env: process.env });
process.exit(r.status ?? 1);
