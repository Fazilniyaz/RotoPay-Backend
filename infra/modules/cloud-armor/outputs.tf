# ─────────────────────────────────────────────
# Cloud Armor module — outputs
# ─────────────────────────────────────────────

output "security_policy_id" {
  description = "Fully-qualified id of the Cloud Armor security policy."
  value       = google_compute_security_policy.this.id
}

output "security_policy_self_link" {
  description = "Self-link of the policy — attach this to a backend service."
  value       = google_compute_security_policy.this.self_link
}

output "security_policy_name" {
  description = "Name of the Cloud Armor security policy."
  value       = google_compute_security_policy.this.name
}
