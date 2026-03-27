# Real-Time Analytics Engine

This module implements a Redis Streams analytics pipeline with bounded in-memory aggregation and Redis time-series snapshots.

## Streaming Pipeline

- Filter: accepts only `agent.evaluated`, `oracle.response`, `user.request`, `blockchain.submission`
- Transform: normalizes payload and timestamp
- Aggregate: computes `1min`, `5min`, `1hour`, `1day` rolling windows
- Persist: writes per-minute snapshots to Redis sorted sets
- Recovery: stores and reloads stream checkpoint from `analytics:checkpoint:last-id`

## Event Stream

- Stream key: `analytics:events`
- Consumer group: `analytics-engine`

Event shape:

```json
{
  "type": "user.request",
  "ts": 1711469824000,
  "userId": "user-1",
  "apiKeyId": "key-1",
  "payload": { "error": false }
}
```

## REST Endpoints

- `GET /analytics/agents/:id/performance?window=1hour`
- `GET /analytics/system/throughput?bucket=1min`
- `GET /analytics/users/:id/activity?window=1hour`

Supported window values: `1min`, `5min`, `1hour`, `1day`

## WebSocket

- Namespace: `/analytics`
- Event: `analytics:update`
- Push interval: every 2 seconds

## Stored Time-Series Keys

- `analytics:ts:system:throughput`
- `analytics:ts:blockchain:submissions`
- `analytics:ts:agent:{id}:performance`
- `analytics:ts:user:{id}:activity`
- `analytics:ts:oracle:{provider}:metrics`
