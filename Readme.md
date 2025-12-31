# Carbide Discovery Service

A standalone Node.js + TypeScript microservice that provides provider discovery and marketplace functionality for the Carbide Network decentralized storage system.

## Overview

The Carbide Discovery Service acts as a central registry and matchmaker for the decentralized storage marketplace:

- **Provider Registry**: Tracks all active storage provider nodes worldwide
- **Health Monitoring**: Automatic health checks every 30 seconds, auto-removes unresponsive providers
- **Marketplace Search**: Find providers by region, tier, and reputation
- **Quote Aggregation**: Request quotes from multiple providers in parallel
- **Statistics**: Real-time marketplace metrics

## Features

✅ **11 HTTP Endpoints** - Complete REST API for provider management  
✅ **Background Health Checks** - Automatic provider monitoring every 30s  
✅ **Auto-removal** - Providers with 5+ failed health checks are removed  
✅ **Regional Indexing** - Fast lookups by geographic region  
✅ **Tier-based Search** - Filter by provider tier  
✅ **Reputation Ranking** - Search results sorted by reputation score  
✅ **CORS Enabled** - Ready for client applications  
✅ **Cloud Deployment** - Deployable to Railway, Render, AWS  

## Tech Stack

- **Runtime**: Node.js 20+
- **Framework**: Fastify 4.x (high-performance HTTP)
- **Language**: TypeScript 5.x
- **Validation**: Zod (runtime type checking)
- **Storage**: In-memory (with Redis migration path)
- **Logging**: Pino (structured logging)

## Quick Start

### Installation

\`\`\`bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Start development server
npm run dev
\`\`\`

### Environment Variables

Create a \`.env\` file:

\`\`\`env
PORT=9090
HOST=0.0.0.0
NODE_ENV=development
HEALTH_CHECK_INTERVAL=30000
PROVIDER_TIMEOUT=300000
MAX_SEARCH_RESULTS=100
LOG_LEVEL=info
\`\`\`

## API Documentation

Base URL: \`http://localhost:9090/api/v1\`

### Provider Management Endpoints

- \`POST /api/v1/providers\` - Register provider
- \`GET /api/v1/providers\` - List providers (with filters)
- \`GET /api/v1/providers/:id\` - Get specific provider
- \`DELETE /api/v1/providers/:id\` - Unregister provider
- \`POST /api/v1/providers/:id/heartbeat\` - Update heartbeat

### Marketplace Endpoints

- \`GET /api/v1/marketplace/search\` - Search providers
- \`POST /api/v1/marketplace/quotes\` - Request quotes
- \`GET /api/v1/marketplace/stats\` - Get statistics

### Health Check

- \`GET /api/v1/health\` - Service health status

For detailed API documentation with examples, see the implementation plan.

## Deployment

### Railway

1. Connect GitHub repository
2. Set environment variables in dashboard
3. Auto-deploys on push to main

### Render

1. Create new Web Service
2. Build command: \`npm install && npm run build\`
3. Start command: \`npm start\`

## License

MIT
