# Backend API Security — Zero-Trust (Blueprint Point 2)

Status of the three sub-points:

| Sub-point            | Status | Notes |
|----------------------|--------|-------|
| No Frontend Trust    | ✅ Already enforced | Every data router runs `authenticate` (JWT signature + expiry, `src/middlewares/auth.middleware.ts`); every controller scopes by `req.user.userId`. Nothing is trusted from the client. |
| Database Security    | ✅ Already safe | **Prisma ORM** only — no raw/`$queryRaw` queries anywhere (`grep` clean). All queries are parameterized/typed, so there is no SQL/NoSQL-injection surface. |
| App Attestation      | ✅ Implemented (backend) | Android Play Integrity + iOS App Attest verification, enforced by `attestationGuard`. Requires config + native builds below. |

---

## How attestation works

A handshake, so we don't re-verify with Google/Apple on every call:

```
1. App  →  POST /api/attestation/challenge            → { challenge }
2. OS   →  Play Integrity token (Android)  /  App Attest attestation|assertion (iOS)
3. App  →  POST /api/attestation/attest   (iOS first run: register key)
        →  POST /api/attestation/verify   (Android token, or iOS assertion)
                                                        → { attestationToken }  (JWT, ~1h)
4. App  →  every request carries  X-Attestation-Token: <attestationToken>
           attestationGuard verifies it (mobile clients only).
```

Backend pieces:
- `helpers/attestation/playIntegrity.ts` — decodes the Android token via the Play Integrity API and
  checks package name, `requestHash == challenge`, `PLAY_RECOGNIZED`, `MEETS_DEVICE_INTEGRITY`.
- `helpers/attestation/appAttest.ts` — full Apple App Attest attestation + assertion verification
  (cert chain → Apple root, nonce binding, App ID / AAGUID / keyId checks, counter monotonicity).
- `controllers/attestation.controller.ts` + `routes/attestation.router.ts` — the handshake endpoints.
- `middlewares/attestation.middleware.ts` — `attestationGuard`, gated by `ATTESTATION_ENFORCED`,
  applied to all `/api` routes. Only mobile binaries (`X-Client: mobile*`) are gated; web is covered
  by reCAPTCHA (blueprint point 4). iOS keys persist in the `AppAttestKey` model.

---

## Required after pulling this change

The Prisma client couldn't regenerate here (Windows file lock on a running dev server). Stop the dev
server, then:

```bash
npx prisma generate      # picks up the new AppAttestKey model
npx prisma db push       # creates it in MongoDB (also pushes the earlier PaidMonth change)
```

## Configuration (env)

```bash
# Master switch — leave false until the production apps ship attestation.
ATTESTATION_ENFORCED=false

ATTESTATION_SECRET=<random 32+ char secret>     # signs challenge + attestation JWT (falls back to JWT_ACCESS_SECRET)

# Android — Play Integrity
ANDROID_PACKAGE_NAME=com.rotopay.app
GCP_PROJECT_NUMBER=1234567890
#   Credentials via Application Default Credentials: the Cloud Run service account
#   (grant it Play Integrity access), or GOOGLE_APPLICATION_CREDENTIALS=<sa.json> locally.

# iOS — App Attest
APPLE_TEAM_ID=ABCDE12345
APPLE_BUNDLE_ID=com.rotopay.app
APP_ATTEST_ENV=development                       # development | production
#   Provide Apple's root CA — see certs/README.md
```

## Client / native build requirement

Play Integrity and App Attest are **native** APIs — they do **not** run in Expo Go, and Metro fails
the bundle if you statically `require()` a package that isn't installed. So the client
(`RotaPay-Native-App/lib/attestation.ts`) does **not** import them; instead a provider is **registered
at runtime**. The app runs fine in dev/Expo Go with no provider (attestation is skipped).

For production: install a native module + config plugin and a dev/release build, then register the
provider once at startup (e.g. in `app/_layout.tsx`):

```ts
import { Platform } from 'react-native';
import { setAttestationProvider } from '@/lib/attestation';
import AppAttest from 'react-native-ios-appattest';            // exposes generateKey/attestKey/generateAssertion
import PlayIntegrity from 'react-native-google-play-integrity'; // exposes requestIntegrityToken

setAttestationProvider(
  Platform.OS === 'ios'
    ? { isSupported: AppAttest.isSupported, generateKey: AppAttest.generateKey,
        attestKey: AppAttest.attestKey, generateAssertion: AppAttest.generateAssertion }
    : { isSupported: PlayIntegrity.isSupported, requestIntegrityToken: PlayIntegrity.requestIntegrityToken }
);
```

Once registered and `ATTESTATION_ENFORCED=true`, scripts hitting the API without a valid attestation
token get `401 App attestation required`.

## Test

```bash
# Handshake issues a challenge:
curl -s -X POST https://api.rotopay.com/api/attestation/challenge | jq

# With enforcement ON, a mobile-flagged request without a token is rejected:
curl -i -X POST https://api.rotopay.com/api/shifts -H 'X-Client: mobile'
#   → 401 App attestation required
```
