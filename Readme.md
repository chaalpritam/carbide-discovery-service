# Carbide Discovery Service

Standalone Node.js + TypeScript microservice that powers provider discovery and marketplace coordination for the Carbide Network. Providers self-register here on heartbeat; clients query this service to find providers, request quotes, and read marketplace stats.

## What it does

- **Provider registry** — tracks active provider nodes (region, tier, price, capacity, reputation).
- **Heartbeat & health checks** — providers POST a heartbeat; a background job pings each one every 30s and removes any that fail 5 consecutive checks.
- **Marketplace search** — query providers by region, tier, minimum reputation; sort by price or reputation.
- **Quote aggregation** — fan-out quote requests to N providers in parallel and return the responses.
- **Stats** — total providers, capacity available, average price.

11 REST endpoints under `/api/v1`. CORS is on by default so browser clients can talk to it directly.

## Tech stack

- **Runtime**: Node.js 20+
- **Framework**: Fastify 4
- **Language**: TypeScript 5
- **Validation**: Zod
- **Storage**: in-memory (Redis-backed mode is on the roadmap)
- **Logging**: Pino (structured JSON)

## Running locally

```sh
npm install
cp .env.example .env     # edit if you want to override defaults
npm run dev              # tsx watch — auto-reloads on save
```

The dev server defaults to `http://localhost:9090`. Health check:

```sh
curl http://localhost:9090/api/v1/health
```

### Pointing a provider at your local discovery

On the provider machine, set the discovery URL in `provider.toml` (or via env var):

```toml
[network]
discovery_endpoint = "http://<this-machine-lan-ip>:9090"
```

Restart the provider; on its next heartbeat it will appear in `GET /api/v1/providers`.

### Tests

```sh
npm test               # vitest run
npm run test:watch     # watch mode
npm run typecheck      # tsc --noEmit
```

## Running in production

The repo includes a `Dockerfile` for a Node 20 production image, plus `npm run build` / `npm start` for bare-metal or PaaS hosting.

### Docker

```sh
docker build -t carbide-discovery .
docker run --rm -p 9090:9090 \
  -e NODE_ENV=production \
  -e LOG_LEVEL=info \
  carbide-discovery
```

### Direct (PaaS / VM)

```sh
npm ci --omit=dev      # install only production deps
npm run build          # tsc → dist/
npm start              # node dist/server.js
```

### PaaS notes

- **Railway**: connect the GitHub repo, set the env vars in the dashboard, auto-deploys on push to `main`.
- **Render**: new Web Service → build `npm install && npm run build`, start `npm start`.
- **Fly.io / ECS / GKE**: use the bundled `Dockerfile`.

Whichever host you pick, point your DNS at it and tell every provider to set `discovery_endpoint` to your public URL. The provider laptop in the brew install bundles `https://discovery.carbide.network` as the default; override that in `provider.toml` if you run your own.

### Environment variables

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `9090` | HTTP listen port |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | `development` | Set to `production` when deployed |
| `HEALTH_CHECK_INTERVAL` | `30000` | ms between provider health pings |
| `PROVIDER_TIMEOUT` | `300000` | ms before a silent provider is considered stale |
| `MAX_SEARCH_RESULTS` | `100` | Cap on marketplace search results |
| `LOG_LEVEL` | `info` | Pino level (`trace`/`debug`/`info`/`warn`/`error`) |

The repo ships an `.env.example` with the full list including Solana-related keys for the on-chain registry mirror.

## API surface

Base URL: `/api/v1`.

### Providers

- `POST   /providers` — register
- `GET    /providers` — list (filters: `region`, `tier`, `minReputation`, `limit`)
- `GET    /providers/:id` — fetch one
- `DELETE /providers/:id` — unregister
- `POST   /providers/:id/heartbeat` — keepalive

### Marketplace

- `GET  /marketplace/search` — search providers
- `POST /marketplace/quotes` — fan-out quote request
- `GET  /marketplace/stats` — totals and averages

### Health

- `GET /health`

Detailed schemas (request/response shapes, error codes) live in [`carbide-dev-docs/DISCOVERY_SERVICE.md`](../carbide-dev-docs/DISCOVERY_SERVICE.md).

## License

MIT
