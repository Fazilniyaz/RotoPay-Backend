# ─────────────────────────────────────────────
# Cloud Armor module — inputs
# ─────────────────────────────────────────────

variable "policy_name" {
  description = "Name of the Cloud Armor security policy."
  type        = string
  default     = "rotopay-armor-policy"
}

variable "description" {
  description = "Human-readable description of the policy."
  type        = string
  default     = "RotoPay WAF: OWASP Top 10 + per-endpoint rate limiting + adaptive bot/DDoS protection."
}

# ── WAF (OWASP Top 10) ────────────────────────
# Cloud Armor ships preconfigured OWASP ModSecurity CRS rule sets. Each entry
# becomes one deny rule using evaluatePreconfiguredWaf(). Priority is derived
# from the list order (base + index) so ordering is stable and gap-free.
variable "owasp_rulesets" {
  description = "Preconfigured WAF rule set names to enable (deny on match)."
  type        = list(string)
  default = [
    "sqli-v33-stable",           # SQL injection
    "xss-v33-stable",            # Cross-site scripting
    "lfi-v33-stable",            # Local file inclusion
    "rfi-v33-stable",            # Remote file inclusion
    "rce-v33-stable",            # Remote code execution
    "methodenforcement-v33-stable",
    "scannerdetection-v33-stable",
    "protocolattack-v33-stable",
    "sessionfixation-v33-stable",
  ]
}

variable "owasp_base_priority" {
  description = "Starting priority for the generated OWASP rules (lower = evaluated first)."
  type        = number
  default     = 9000
}

variable "waf_sensitivity" {
  description = "OWASP CRS sensitivity/paranoia level 1-4. Higher = stricter but more false positives. Start at 1."
  type        = number
  default     = 1
}

variable "owasp_action" {
  description = "Action taken when a WAF rule matches."
  type        = string
  default     = "deny(403)"
}

# ── Rate limiting: credential endpoints (login / register / google) ───────────
variable "auth_paths" {
  description = "Request-path prefixes treated as credential endpoints for strict rate limiting."
  type        = list(string)
  default     = ["/api/auth/login", "/api/auth/register", "/api/auth/google"]
}

variable "auth_rate_count" {
  description = "Max credential requests per IP within auth_rate_interval_sec before banning."
  type        = number
  default     = 10
}

variable "auth_rate_interval_sec" {
  description = "Window (seconds) over which auth_rate_count is measured."
  type        = number
  default     = 60
}

variable "auth_ban_duration_sec" {
  description = "How long (seconds) an offending IP is banned after exceeding the credential limit."
  type        = number
  default     = 600
}

# ── Rate limiting: OTP / email endpoints (verify / resend / forgot / reset) ────
variable "otp_paths" {
  description = "Request-path prefixes treated as OTP/email endpoints (even stricter)."
  type        = list(string)
  default = [
    "/api/auth/verify-email",
    "/api/auth/resend-verification",
    "/api/auth/forgot-password",
    "/api/auth/reset-password",
  ]
}

variable "otp_rate_count" {
  description = "Max OTP/email requests per IP within otp_rate_interval_sec before banning."
  type        = number
  default     = 5
}

variable "otp_rate_interval_sec" {
  description = "Window (seconds) over which otp_rate_count is measured."
  type        = number
  default     = 60
}

variable "otp_ban_duration_sec" {
  description = "How long (seconds) an offending IP is banned after exceeding the OTP limit."
  type        = number
  default     = 1800
}

# ── Adaptive Protection (ML-based bot / L7 DDoS defense) ──────────────────────
variable "enable_adaptive_protection" {
  description = "Enable Adaptive Protection (machine-learning Layer-7 DDoS / bot detection)."
  type        = bool
  default     = true
}

# ── reCAPTCHA Enterprise bot management (browser flows only) ──────────────────
# When enabled, requests to auth_paths that lack a valid reCAPTCHA token are sent
# a Google reCAPTCHA challenge (redirect action). Intended for the WEB app's
# browser traffic — mobile clients authenticate via Play Integrity / App Attest
# (see points 2 & 3), so leave this OFF unless the web forms send reCAPTCHA
# tokens, otherwise JSON/API callers would be redirected to a challenge page.
variable "enable_recaptcha" {
  description = "Add a reCAPTCHA Enterprise manual-challenge rule on credential endpoints (browser flows)."
  type        = bool
  default     = false
}

variable "recaptcha_priority" {
  description = "Priority of the reCAPTCHA challenge rule (evaluated before the WAF rules)."
  type        = number
  default     = 1500
}

# ── Logging ───────────────────────────────────
variable "log_level" {
  description = "Cloud Armor logging verbosity: NORMAL or VERBOSE."
  type        = string
  default     = "VERBOSE"
}
