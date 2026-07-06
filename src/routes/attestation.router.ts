// src/routes/attestation.router.ts
// ─────────────────────────────────────────────
// App Attestation handshake router (device-level; no login required).
// ─────────────────────────────────────────────

import { Router } from "express";
import * as attestationController from "../controllers/attestation.controller";

const router = Router();

router.post("/challenge", attestationController.getChallenge);
router.post("/attest", attestationController.attest); // iOS key registration
router.post("/verify", attestationController.verify); // Android token / iOS assertion

export default router;
