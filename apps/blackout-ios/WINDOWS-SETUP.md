# Shipping BlackOut iOS from Windows (no Mac)

**One repo:** `coreentryadmin-web/blackout-web` — iOS shell is `apps/blackout-ios/`.

Flow: **push to GitHub → Codemagic cloud Mac → TestFlight → App Store**.

---

## STEP 1 — Apple Developer ✅

BLACKOUT TRADE LLC · Team **`ZA32C782N5`** · active through July 2027.

---

## STEP 2 — App Store Connect app ✅

| Field | Value |
|-------|--------|
| Bundle ID | `com.blackout-trades.app` |
| Apple ID | `6787797476` |
| SKU | `blackout-ios-2020` |

Finish: **Content Rights**, **Category: Finance**, **Age Rating**.

---

## STEP 3 — App Store Connect API key (you) · ~3 min

1. App Store Connect → **Users and Access → Integrations → App Store Connect API**
2. **Generate API Key**, role **App Manager**
3. Download **`.p8`** (one-time) + note **Key ID** + **Issuer ID**

---

## STEP 4 — Codemagic (you) · ~10 min

1. [codemagic.io](https://codemagic.io) → sign in with GitHub
2. **Add application** → **`coreentryadmin-web/blackout-web`**
3. Codemagic detects `apps/blackout-ios/codemagic.yaml` (includes `working_directory`)
4. **Team → Integrations → App Store Connect** → name **`BlackOut ASC`** → upload `.p8`
5. **Start new build** → workflow **`ios-release`** → branch **`main`**

---

## STEP 5 — TestFlight on iPhone

Install **TestFlight** → open BlackOut build → verify:

- Site loads (not white screen)
- **Email-code sign-in** works (avoid Google in WebView for v1)
- **No pricing / checkout** visible in-app
- Premium account reaches `/dashboard`

---

## STEP 6 — App Store review (when ready)

Screenshots, privacy label, demo account in review notes. See `APP_STORE.md`.

---

## Rejection-risk checklist

- [x] In-app pricing hidden (`BlackOutiOSApp` + `html.ios-app` on web — shipped)
- [ ] Demo premium account for reviewer
- [ ] Account deletion via Clerk `/account` (enable in Clerk dashboard)
- [ ] Email sign-in in app (not Google OAuth in WebView)
