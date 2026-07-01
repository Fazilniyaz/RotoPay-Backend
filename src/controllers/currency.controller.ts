// src/controllers/currency.controller.ts
// ─────────────────────────────────────────────
// Currency Controller — live conversion rate
//
// GET /api/currency/rate?from=USD&to=INR
//   → { from, to, rate, date }   (rate = how many `to` units per one `from`)
// ─────────────────────────────────────────────

import { Request, Response } from "express";

import { asyncHandler } from "../helpers/async.handler";
import { sendSuccess, sendError } from "../helpers/api.response";
import { getRate, rateDate } from "../utilities/currency";

const isCode = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z]{3}$/.test(v);

export const getConversionRate = asyncHandler(async (req: Request, res: Response) => {
  const { from, to } = req.query;

  if (!isCode(from) || !isCode(to)) {
    return sendError(res, "from and to must be 3-letter currency codes", 400);
  }

  try {
    const rate = await getRate(from, to);
    sendSuccess(res, "Conversion rate fetched successfully", {
      from: from.toUpperCase(),
      to: to.toUpperCase(),
      rate,
      date: rateDate(),
    });
  } catch (err: any) {
    sendError(res, err?.message || "Unable to fetch conversion rate", 502);
  }
});
