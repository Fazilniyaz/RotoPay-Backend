# Certificates

## Apple App Attest Root CA

iOS App Attest verification needs Apple's App Attest root certificate as the trust
anchor. It is **not** bundled (so the trust anchor is auditable and can be rotated).

Download it and place it here as `Apple_App_Attestation_Root_CA.pem`:

```bash
curl -o certs/Apple_App_Attestation_Root_CA.pem \
  https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem
```

The path is configurable via `APPLE_APP_ATTEST_ROOT_CA_PATH` (defaults to
`certs/Apple_App_Attestation_Root_CA.pem`).

This cert is public and safe to commit.
