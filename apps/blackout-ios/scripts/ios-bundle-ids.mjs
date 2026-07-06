/**
 * Capacitor appId vs Apple bundle ID.
 *
 * Capacitor validates appId as a Java package name (no hyphens). Apple ASC / Developer
 * already registered com.blackout-trades.app — we patch Xcode after cap add/sync.
 */
export const CAPACITOR_APP_ID = "com.blackouttrades.app";
export const APPLE_BUNDLE_ID = "com.blackout-trades.app";
