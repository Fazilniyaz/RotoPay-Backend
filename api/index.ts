import app from '../src/app';
import { initMongoRateStore } from '../src/middlewares/mongo.rate.store';

// Vercel entry point. Ensure the rate-limit TTL index exists (fire-and-forget,
// idempotent) so old counter windows auto-purge. Never blocks request handling.
void initMongoRateStore();

export default app;
