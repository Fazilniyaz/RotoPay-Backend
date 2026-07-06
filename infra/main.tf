# ─────────────────────────────────────────────
# RotoPay API — Global External Application Load Balancer
# fronting Cloud Run, protected by Cloud Armor.
#
#   Internet ──▶ Forwarding rule (443)
#            ──▶ HTTPS target proxy (managed TLS cert)
#            ──▶ URL map
#            ──▶ Backend service  ◀── Cloud Armor policy (WAF + rate limits)
#            ──▶ Serverless NEG   ──▶ Cloud Run (RotoPay backend)
#
# Cloud Armor can ONLY protect a backend running on GCP. This assumes the API is
# deployed to Cloud Run (var.cloud_run_service_name). If the API is still on
# Vercel, deploy it to Cloud Run first — see README.
# ─────────────────────────────────────────────

provider "google" {
  project = var.project_id
  region  = var.region
}

# ── Cloud Armor security policy (WAF + rate limiting + adaptive protection) ──
module "cloud_armor" {
  source = "./modules/cloud-armor"

  policy_name      = "${var.name_prefix}-armor"
  waf_sensitivity  = var.waf_sensitivity
  auth_rate_count  = var.auth_rate_count
  otp_rate_count   = var.otp_rate_count
  enable_recaptcha = var.enable_recaptcha
}

# ── Serverless NEG → Cloud Run ──
resource "google_compute_region_network_endpoint_group" "neg" {
  name                  = "${var.name_prefix}-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = var.cloud_run_service_name
  }
}

# ── Backend service with the Cloud Armor policy attached ──
resource "google_compute_backend_service" "default" {
  name                  = "${var.name_prefix}-backend"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTPS"
  security_policy       = module.cloud_armor.security_policy_self_link

  backend {
    group = google_compute_region_network_endpoint_group.neg.id
  }

  log_config {
    enable      = true
    sample_rate = 1.0
  }
}

# ── URL map → backend ──
resource "google_compute_url_map" "default" {
  name            = "${var.name_prefix}-urlmap"
  default_service = google_compute_backend_service.default.id
}

# ── Google-managed TLS certificate for the API domain ──
resource "google_compute_managed_ssl_certificate" "default" {
  name = "${var.name_prefix}-cert"

  managed {
    domains = [var.domain]
  }
}

# ── HTTPS target proxy + reserved IP + forwarding rule (443) ──
resource "google_compute_target_https_proxy" "default" {
  name             = "${var.name_prefix}-https-proxy"
  url_map          = google_compute_url_map.default.id
  ssl_certificates = [google_compute_managed_ssl_certificate.default.id]
}

resource "google_compute_global_address" "default" {
  name = "${var.name_prefix}-ip"
}

resource "google_compute_global_forwarding_rule" "https" {
  name                  = "${var.name_prefix}-https-fr"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.default.id
  port_range            = "443"
  target                = google_compute_target_https_proxy.default.id
}

# ── Optional: port-80 listener that 301-redirects HTTP → HTTPS ──
resource "google_compute_url_map" "redirect" {
  count = var.enable_http_redirect ? 1 : 0
  name  = "${var.name_prefix}-redirect"

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "redirect" {
  count   = var.enable_http_redirect ? 1 : 0
  name    = "${var.name_prefix}-http-proxy"
  url_map = google_compute_url_map.redirect[0].id
}

resource "google_compute_global_forwarding_rule" "http" {
  count                 = var.enable_http_redirect ? 1 : 0
  name                  = "${var.name_prefix}-http-fr"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.default.id
  port_range            = "80"
  target                = google_compute_target_http_proxy.redirect[0].id
}
