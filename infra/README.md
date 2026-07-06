# RotoPay — Infrastructure & Edge Defense (Cloud Armor)

This directory implements **Security Blueprint point 1 — Infrastructure & Edge Defense (GCP)** as
Terraform (Infrastructure as Code):

- **WAF** — Google Cloud Armor with the preconfigured **OWASP Top 10** rule sets (SQLi, XSS, LFI, RFI,
  RCE, protocol attacks, scanner detection, session fixation, method enforcement).
- **Rate limiting** — strict per-IP rate-based bans on the high-risk endpoints
  (`/api/auth/login`, `/api/auth/register`, `/api/auth/google`) and, even stricter, on the OTP/email
  endpoints (`/api/auth/verify-email`, `/resend-verification`, `/forgot-password`, `/reset-password`).
- **Bot / DDoS** — **Adaptive Protection** (ML Layer-7 defense) on by default; an optional
  **reCAPTCHA Enterprise** manual-challenge rule for browser flows (off by default).
- All of the above sit in front of a **Global External Application Load Balancer** that routes to the
  backend running on **Cloud Run**.

```
Internet ─▶ 443 forwarding rule ─▶ HTTPS proxy (managed TLS) ─▶ URL map
        ─▶ Backend service  ◀── Cloud Armor policy (WAF + rate limits + adaptive protection)
        ─▶ Serverless NEG   ─▶ Cloud Run (RotoPay backend)
```

---

## ⚠️ Prerequisite: the backend must run on GCP

Cloud Armor can only protect a backend that runs on GCP (Cloud Run / GKE / GCE). The API currently
ships to **Vercel** (`vercel.json`). Cloud Armor does **nothing** for a Vercel deployment.

So before this Terraform is useful, deploy the API to **Cloud Run** and put its service name in
`cloud_run_service_name`. Minimal path:

```bash
# from RotoPay-Backend/
gcloud run deploy rotopay-backend \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production,TRUST_PROXY=1   # + your other env vars / secrets
```

> Set `TRUST_PROXY=1` (or leave it — it defaults to `1` when `NODE_ENV=production`). This makes Express
> read the real client IP from `X-Forwarded-For` behind the load balancer, so the app-level rate
> limiter and logs see the actual caller instead of the LB. See `src/app.ts`.

Store real secrets (JWT, SMTP, ImageKit, DB URL) in **Secret Manager** and reference them with
`--set-secrets`, not plain env vars.

---

## Deploy

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars   # then edit values

terraform init
terraform plan     # review what will be created
terraform apply
```

After `apply`:

1. Note the `load_balancer_ip` output and create an **A record**: `api.rotopay.com → <that IP>`.
2. Wait for the managed TLS cert to become `ACTIVE` (15–60 min after DNS resolves):
   ```bash
   gcloud compute ssl-certificates describe rotopay-api-cert --global --format='value(managed.status)'
   ```
3. Point the web app + mobile app API base URL at `https://api.rotopay.com`.

---

## Verify it works

```bash
# OWASP WAF — a SQLi probe should be blocked with 403:
curl -i "https://api.rotopay.com/api/currency/rate?from=USD%27%20OR%201=1--&to=INR"

# Rate limiting — hammer login; after the threshold you should start getting 429:
for i in $(seq 1 20); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST https://api.rotopay.com/api/auth/login \
    -H 'Content-Type: application/json' -d '{"email":"x@x.com","password":"x"}';
done
```

Inspect matches under **Network Security → Cloud Armor** (logs are `VERBOSE`).

---

## Tuning

All knobs live in `terraform.tfvars` / `variables.tf`:

| Variable           | Meaning                                                                 | Default |
|--------------------|-------------------------------------------------------------------------|---------|
| `waf_sensitivity`  | OWASP CRS paranoia level 1–4. Higher = stricter, more false positives.  | `1`     |
| `auth_rate_count`  | Login/register/google requests per IP per minute before a ban.          | `10`    |
| `otp_rate_count`   | OTP/email requests per IP per minute before a ban.                       | `5`     |
| `enable_recaptcha` | reCAPTCHA Enterprise challenge on credential endpoints (browser flows). | `false` |

Fine-grained controls (ban durations, path lists, per-ruleset priorities) are in
`modules/cloud-armor/variables.tf`.

**Start permissive, then tighten.** Run `waf_sensitivity = 1` in "preview"/monitor mode first if you
have production-like traffic, watch the Cloud Armor logs for false positives, then raise it.

---

## About reCAPTCHA (`enable_recaptcha`)

Kept **off** by default. When on, credential requests **without** a valid reCAPTCHA token are sent a
Google challenge (a `redirect` action). That's correct for the **web app's browser forms** but would
break **mobile/API** clients (they'd be redirected to an HTML challenge). Mobile bot-defense is handled
separately by **Play Integrity / App Attest** (blueprint points 2 & 3), and the frictionless web
reCAPTCHA v3 token flow is blueprint **point 4**. Enable this only once the web forms actually attach
reCAPTCHA tokens.

---

## What this covers vs. what's next

- ✅ Point 1 — Cloud Armor WAF (OWASP), per-endpoint rate limiting, adaptive bot/DDoS, LB wiring.
- ✅ App made proxy-aware (`trust proxy`) so IP-based defenses are accurate.
- ⬜ reCAPTCHA **frontend** token flow (web) — blueprint point 4.
- ⬜ Play Integrity / App Attest verification — blueprint points 2 & 3.
