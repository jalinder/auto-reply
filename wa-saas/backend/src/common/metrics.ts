import { createServer } from 'http';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/** One registry per process; API serves it at /metrics, workers on METRICS_PORT. */
export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const httpDuration = new Histogram({
  name: 'relay_http_request_duration_seconds', help: 'API request latency', registers: [registry],
  labelNames: ['method', 'route', 'status'], buckets: [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});
export const authFailures = new Counter({ name: 'relay_auth_failures_total', help: 'Failed sign-in attempts', registers: [registry], labelNames: ['reason'] });
export const sendOutcomes = new Counter({ name: 'relay_send_outcomes_total', help: 'Send attempts by outcome', registers: [registry], labelNames: ['connector', 'outcome'] });
export const queueDepth = new Gauge({ name: 'relay_queue_jobs', help: 'Jobs per queue and state', registers: [registry], labelNames: ['queue', 'state'] });
export const oldestWaiting = new Gauge({ name: 'relay_queue_oldest_waiting_seconds', help: 'Age of the oldest waiting job', registers: [registry], labelNames: ['queue'] });
export const connectionsByStatus = new Gauge({ name: 'relay_connections', help: 'WhatsApp connections by status', registers: [registry], labelNames: ['connector', 'status'] });
export const browserSessions = new Gauge({ name: 'relay_browser_sessions', help: 'Active browser sessions on this worker', registers: [registry] });
export const browserEvents = new Counter({ name: 'relay_browser_events_total', help: 'Browser session lifecycle events', registers: [registry], labelNames: ['event'] });

/** Minimal internal-only metrics endpoint for worker processes. Bind to a private network. */
export function serveMetrics(port: number) {
  if (!port) return;
  createServer(async (req, res) => {
    if (req.url !== '/metrics') { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  }).listen(port, '0.0.0.0');
}
