# ─────────────────────────────────────────────
# Cloud Armor security policy
#
# One backend security policy that fronts the RotoPay API's backend service:
#   • per-IP rate limiting (rate-based ban) on credential + OTP endpoints
#   • OWASP Top 10 preconfigured WAF rules (deny on match)
#   • optional reCAPTCHA Enterprise manual challenge (browser flows)
#   • Adaptive Protection (ML Layer-7 DDoS / bot detection)
# Rules are evaluated low-priority-number first; the default rule allows the rest.
# ─────────────────────────────────────────────

locals {
  # Build CEL match expressions from the configured path prefixes, e.g.
  #   request.path.startsWith('/api/auth/login') || request.path.startsWith('/api/auth/register')
  auth_expr = join(" || ", [for p in var.auth_paths : "request.path.startsWith('${p}')"])
  otp_expr  = join(" || ", [for p in var.otp_paths : "request.path.startsWith('${p}')"])

  # Precompute a stable priority per OWASP rule set (base + list index).
  owasp_rules = {
    for idx, rs in var.owasp_rulesets : rs => {
      priority = var.owasp_base_priority + idx
      ruleset  = rs
    }
  }
}

resource "google_compute_security_policy" "this" {
  name        = var.policy_name
  description = var.description
  type        = "CLOUD_ARMOR"

  # Inspect JSON request bodies (this API is JSON-only) so the WAF can catch
  # payload-based attacks, and log verbosely for auditing / tuning.
  advanced_options_config {
    json_parsing = "STANDARD"
    log_level    = var.log_level
  }

  # ── Adaptive Protection: ML-based Layer-7 DDoS / bot detection ──
  dynamic "adaptive_protection_config" {
    for_each = var.enable_adaptive_protection ? [1] : []
    content {
      layer_7_ddos_defense_config {
        enable = true
      }
    }
  }

  # ── Rate limit: credential endpoints (login / register / google) ──
  rule {
    action      = "rate_based_ban"
    priority    = 1000
    description = "Rate-limit credential endpoints per IP (brute-force protection)."
    match {
      expr {
        expression = local.auth_expr
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = var.auth_rate_count
        interval_sec = var.auth_rate_interval_sec
      }
      ban_duration_sec = var.auth_ban_duration_sec
    }
  }

  # ── Rate limit: OTP / email endpoints (verify / resend / forgot / reset) ──
  rule {
    action      = "rate_based_ban"
    priority    = 1100
    description = "Rate-limit OTP/email endpoints per IP (stricter)."
    match {
      expr {
        expression = local.otp_expr
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = var.otp_rate_count
        interval_sec = var.otp_rate_interval_sec
      }
      ban_duration_sec = var.otp_ban_duration_sec
    }
  }

  # ── Optional: reCAPTCHA Enterprise manual challenge (browser flows) ──
  dynamic "rule" {
    for_each = var.enable_recaptcha ? [1] : []
    content {
      action      = "redirect"
      priority    = var.recaptcha_priority
      description = "reCAPTCHA Enterprise challenge on credential endpoints (browser flows)."
      match {
        expr {
          expression = local.auth_expr
        }
      }
      redirect_options {
        type = "GOOGLE_RECAPTCHA"
      }
    }
  }

  # ── OWASP Top 10 preconfigured WAF rules ──
  dynamic "rule" {
    for_each = local.owasp_rules
    content {
      action      = var.owasp_action
      priority    = rule.value.priority
      description = "OWASP CRS: ${rule.value.ruleset}"
      match {
        expr {
          expression = "evaluatePreconfiguredWaf('${rule.value.ruleset}', {'sensitivity': ${var.waf_sensitivity}})"
        }
      }
    }
  }

  # ── Default rule: allow everything else (must exist, lowest priority) ──
  rule {
    action      = "allow"
    priority    = 2147483647
    description = "Default allow."
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
  }
}
