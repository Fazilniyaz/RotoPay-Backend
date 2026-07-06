terraform {
  required_version = ">= 1.3.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.20.0, < 7.0.0"
    }
  }

  # Recommended: store state remotely so the team shares one source of truth.
  # Create the bucket first, then uncomment and run `terraform init -migrate-state`.
  # backend "gcs" {
  #   bucket = "rotopay-tfstate"
  #   prefix = "cloud-armor"
  # }
}
