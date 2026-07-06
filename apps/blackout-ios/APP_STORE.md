# BlackOut iOS — App Store Connect (filled)

**Canonical location:** `apps/blackout-ios/` inside **`coreentryadmin-web/blackout-web`** — one repo only.

| Field | Value |
|-------|--------|
| **Legal entity** | BLACKOUT TRADE LLC |
| **Team ID** | `ZA32C782N5` |
| **Bundle ID** | `com.blackout-trades.app` (Apple ASC / signing) |
| **App Store Connect Apple ID** | `6787797476` |
| **SKU** | `blackout-ios-2020` |
| **WKWebView UA token** | `BlackOutiOSApp` (must match `src/app/layout.tsx`) |

## Codemagic (recommended — no Mac)

1. [codemagic.io](https://codemagic.io) → add GitHub app **`coreentryadmin-web/blackout-web`**
2. Root **`codemagic.yaml`** auto-detected (`working_directory: apps/blackout-ios`)
3. Integration **BlackOut ASC** (App Store Connect API `.p8`)
4. Run workflow **ios-release** → TestFlight (~15 min)

### Signing failures (checklist)

| Symptom | Fix |
|---------|-----|
| Team `663D77E68E` or other ID (not `ZA32C782N5`) | Codemagic **app env vars** override `codemagic.yaml`. Delete wrong `APPLE_TEAM_ID` / `BUNDLE_ID` in Codemagic → your app → Environment variables. |
| Bundle `com.blackout-trader.app` (typo) | Must be **`com.blackout-trades.app`** (with **s**). Same — remove bad Codemagic env override. |
| No IOS_DISTRIBUTION certificate | API key **BlackOut ASC** must be **App Manager** on **BLACKOUT TRADE LLC** (`ZA32C782N5`). Regenerate `.p8` in ASC if needed. |
| Manual cert (optional) | Codemagic → Team settings → Code signing identities → Generate **Apple Distribution** with **BlackOut ASC** key. |

From repo root: `npm run validate:ios-config`

### Sign-in on TestFlight

Google (and other social) OAuth **does not work** inside the Capacitor WKWebView — Clerk returns `authorization_invalid` on the OAuth callback. The web app hides social buttons when running in the iOS shell; **use email + one-time code** to sign in. Native Google sign-in is a future enhancement (Clerk native SDK or ASWebAuthenticationSession).

## GitHub Actions (alternative)

Repo → Settings → Secrets → Actions:

| Secret | Value |
|--------|--------|
| `APPLE_TEAM_ID` | `ZA32C782N5` |
| `APP_STORE_CONNECT_ISSUER_ID` | from ASC API page |
| `APP_STORE_CONNECT_KEY_ID` | from ASC API page |
| `APP_STORE_CONNECT_PRIVATE_KEY` | contents of `.p8` file |

Then: Actions → **BlackOut iOS TestFlight** → Run workflow.

## App Store Connect — still to complete (browser)

- [ ] **Content Rights** → Set Up
- [ ] **Category** → Primary: Finance
- [ ] **Age Rating** questionnaire
- [ ] **App Privacy** nutrition label
- [ ] **1024×1024 icon** + iPhone screenshots
- [ ] **Review notes:** premium demo account email + password (email-code OK)

## Reviewer demo account (you create)

```
Email: <premium subscriber test account>
Sign-in: email one-time code (or password if set)
Notes: Subscription managed on web; no in-app purchases. Pricing hidden in app.
```
