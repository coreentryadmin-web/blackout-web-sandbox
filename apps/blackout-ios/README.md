# BlackOut — iOS app shell

Lives in **`blackout-web`** at `apps/blackout-ios/` (same repo as the Next.js app).

A native iOS wrapper (Capacitor) around the live web app at **https://blackouttrades.com**.
It loads the production site in a `WKWebView` and adds native value (push, splash, status bar).

> **Payments:** sign-in only. Users subscribe on the website / Whop. No checkout in-app
> (App Store 3.1.1). The web app hides pricing when the `BlackOutiOSApp` user-agent is present.

---

## Layout

```
blackout-web/
  apps/blackout-ios/     ← you are here (Capacitor + codemagic.yaml)
  src/                   ← Next.js app (ios-app CSS + UA detection)
```

The standalone `blackout-ios` GitHub repo is **deprecated** — use this folder only.

---

## Local dev (Mac only for Xcode)

```bash
cd apps/blackout-ios
npm install
npx cap add ios      # first time — creates ios/
npx cap sync ios
npx cap open ios
```

Bundle ID: **`com.blackout-trades.app`**. Team: **`ZA32C782N5`**.

---

## Cloud build (no Mac)

See **`APP_STORE.md`** and **`WINDOWS-SETUP.md`**.

```bash
# from repo root
npm run validate:ios-config
```

Codemagic: connect **`coreentryadmin-web/blackout-web`**, workflow **`ios-release`**.

---

## Web ↔ iOS contract

| iOS (`capacitor.config.ts`) | Web (`blackout-web`) |
|-----------------------------|----------------------|
| `appendUserAgent: "BlackOutiOSApp"` | `layout.tsx` adds `html.ios-app` class |
| Loads `https://blackouttrades.com` | `.hide-in-ios-app` / `.show-in-ios-app` in CSS |

Do not change the UA token on one side without the other.
