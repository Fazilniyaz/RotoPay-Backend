# ─────────────────────────────────────────────
# Root outputs
# ─────────────────────────────────────────────

output "load_balancer_ip" {
  description = "Reserved global IP of the load balancer. Point your domain's A record here."
  value       = google_compute_global_address.default.address
}

output "dns_instructions" {
  description = "What to do after apply."
  value       = "Create an A record: ${var.domain} → ${google_compute_global_address.default.address}. The managed TLS cert becomes ACTIVE (can take 15-60 min) once DNS resolves."
}

output "security_policy_name" {
  description = "Cloud Armor policy name (inspect rules/logs under Network Security → Cloud Armor)."
  value       = module.cloud_armor.security_policy_name
}

output "ssl_certificate_name" {
  description = "Managed SSL certificate name (watch its status until ACTIVE)."
  value       = google_compute_managed_ssl_certificate.default.name
}

output "backend_service_name" {
  description = "Backend service the Cloud Armor policy is attached to."
  value       = google_compute_backend_service.default.name
}
