# ─────────────────────────────────────────────
# Root inputs
# ─────────────────────────────────────────────

variable "project_id" {
  description = "GCP project id that hosts the load balancer + Cloud Run service."
  type        = string
}

variable "region" {
  description = "Region of the Cloud Run service (must match where the API is deployed)."
  type        = string
  default     = "us-central1"
}

variable "name_prefix" {
  description = "Prefix applied to created resources (LB, backend service, cert, …)."
  type        = string
  default     = "rotopay-api"
}

variable "cloud_run_service_name" {
  description = "Name of the existing Cloud Run service that runs the RotoPay backend."
  type        = string
}

variable "domain" {
  description = "Domain the API is served on, e.g. api.rotopay.com. A Google-managed TLS cert is issued for it."
  type        = string
}

variable "enable_http_redirect" {
  description = "Also create a port-80 listener that 301-redirects HTTP → HTTPS."
  type        = bool
  default     = true
}

# ── Cloud Armor tuning (passed through to the module) ──
variable "waf_sensitivity" {
  description = "OWASP CRS sensitivity 1-4 (start at 1, raise after tuning out false positives)."
  type        = number
  default     = 1
}

variable "auth_rate_count" {
  description = "Credential requests per IP per minute before a temporary ban."
  type        = number
  default     = 10
}

variable "otp_rate_count" {
  description = "OTP/email requests per IP per minute before a temporary ban."
  type        = number
  default     = 5
}

variable "enable_recaptcha" {
  description = "Enable the reCAPTCHA Enterprise manual-challenge rule (browser flows only — see module docs)."
  type        = bool
  default     = false
}
