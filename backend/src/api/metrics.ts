import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from "prom-client";

export const register = new Registry();

// Collect Node.js default metrics (CPU, memory, event loop, GC)
collectDefaultMetrics({ register });

// ── HTTP Metrics ──────────────────────────────────────────────────

export const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [register],
});

export const httpRequestDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

// ── Queue Metrics ─────────────────────────────────────────────────

export const queueJobsTotal = new Counter({
  name: "queue_jobs_total",
  help: "Total number of queue jobs processed",
  labelNames: ["queue", "status"] as const,
  registers: [register],
});

export const queueJobDuration = new Histogram({
  name: "queue_job_duration_seconds",
  help: "Queue job processing duration in seconds",
  labelNames: ["queue"] as const,
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60],
  registers: [register],
});

// ── Cache Metrics ─────────────────────────────────────────────────

export const cacheOperations = new Counter({
  name: "cache_operations_total",
  help: "Total cache operations (hit/miss)",
  labelNames: ["operation"] as const,
  registers: [register],
});

// ── Starknet Metrics ──────────────────────────────────────────────

export const starknetTxTotal = new Counter({
  name: "starknet_transactions_total",
  help: "Total Starknet transactions submitted",
  labelNames: ["type", "status"] as const,
  registers: [register],
});

// ── Business Metrics ──────────────────────────────────────────────

export const ticketsMinted = new Counter({
  name: "tickets_minted_total",
  help: "Total tickets minted",
  registers: [register],
});

export const ticketsScanned = new Counter({
  name: "tickets_scanned_total",
  help: "Total tickets scanned",
  labelNames: ["result"] as const,
  registers: [register],
});

export const activeListings = new Gauge({
  name: "marketplace_active_listings",
  help: "Current number of active marketplace listings",
  registers: [register],
});

export const bridgedTicketsTotal = new Counter({
  name: "bridged_tickets_total",
  help: "Total bridged tickets by status",
  labelNames: ["status"] as const,
  registers: [register],
});
