import { z } from 'zod';
import { Provider, ProviderListRequest, ProviderListResponse } from './provider.js';
import { ProviderRequirements, ProviderRequirementsSchema } from './storage.js';
import { Region, RegionSchema } from './provider.js';

/**
 * Service status enum
 */
export enum ServiceStatus {
  Healthy = 'Healthy',
  Degraded = 'Degraded',
  Overloaded = 'Overloaded',
  Maintenance = 'Maintenance',
  Unavailable = 'Unavailable'
}

/**
 * Health check response from providers or discovery service
 */
export interface HealthCheckResponse {
  status: ServiceStatus;            // Service status
  timestamp: string;                // ISO 8601 timestamp
  version: string;                  // Service version
  available_storage?: number | null; // Available storage (bytes)
  load?: number | null;             // Load 0.0-1.0
  reputation?: string | null;       // Reputation score
}

/**
 * Storage quote request from client
 */
export interface StorageQuoteRequest {
  file_size: number;                // File size in bytes
  replication_factor: number;       // 1-10 copies
  duration_months: number;          // Contract duration
  requirements: ProviderRequirements;
  preferred_regions: Region[];      // Preferred regions
}

/**
 * Storage quote response from provider
 */
export interface StorageQuoteResponse {
  provider_id: string;              // ProviderId (UUID)
  price_per_gb_month: string;       // Price as decimal string
  total_monthly_cost: string;       // Total monthly cost
  can_fulfill: boolean;             // Can meet requirements?
  available_capacity: number;       // Available capacity (bytes)
  estimated_start_time: number;     // Hours until start
  valid_until: string;              // ISO 8601 timestamp
}

/**
 * Error message structure
 */
export interface ErrorMessage {
  code: string;                     // Error code
  message: string;                  // Human-readable message
  details?: Record<string, string> | null; // Optional error details
}

/**
 * Network message envelope
 */
export interface NetworkMessage {
  id: string;                       // UUID
  message_type: MessageType;        // Tagged union of message types
  timestamp: string;                // ISO 8601 timestamp
  correlation_id: string | null;    // UUID for request/response pairing
  version: string;                  // Protocol version (e.g., "1.0")
}

/**
 * MessageType discriminated union
 */
export type MessageType =
  | { type: 'ProviderAnnouncement'; data: Provider }
  | { type: 'ProviderListRequest'; data: ProviderListRequest }
  | { type: 'ProviderListResponse'; data: ProviderListResponse }
  | { type: 'HealthCheckRequest'; data: null }
  | { type: 'HealthCheckResponse'; data: HealthCheckResponse }
  | { type: 'StorageQuoteRequest'; data: StorageQuoteRequest }
  | { type: 'StorageQuoteResponse'; data: StorageQuoteResponse }
  | { type: 'Error'; data: ErrorMessage };

/**
 * Zod schemas for validation
 */
export const ServiceStatusSchema = z.nativeEnum(ServiceStatus);

export const HealthCheckResponseSchema = z.object({
  status: ServiceStatusSchema,
  timestamp: z.string().datetime(),
  version: z.string(),
  available_storage: z.number().int().min(0).nullable().optional(),
  load: z.number().min(0).max(1).nullable().optional(),
  reputation: z.string().nullable().optional()
});

export const StorageQuoteRequestSchema = z.object({
  file_size: z.number().int().positive(),
  replication_factor: z.number().int().min(1).max(10),
  duration_months: z.number().int().positive(),
  requirements: ProviderRequirementsSchema,
  preferred_regions: z.array(RegionSchema)
});

export const StorageQuoteResponseSchema = z.object({
  provider_id: z.string().uuid(),
  price_per_gb_month: z.string(),
  total_monthly_cost: z.string(),
  can_fulfill: z.boolean(),
  available_capacity: z.number().int().min(0),
  estimated_start_time: z.number().int().min(0),
  valid_until: z.string().datetime()
});

export const ErrorMessageSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.string()).nullable().optional()
});

/**
 * Error codes
 */
export const ERROR_CODES = {
  INVALID_REQUEST: 'INVALID_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  PROVIDER_NOT_FOUND: 'PROVIDER_NOT_FOUND',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  INSUFFICIENT_STORAGE: 'INSUFFICIENT_STORAGE',
  PRICE_TOO_LOW: 'PRICE_TOO_LOW',
  INVALID_PROOF: 'INVALID_PROOF',
  STORAGE_FULL: 'STORAGE_FULL',
  NETWORK_ERROR: 'NETWORK_ERROR',
  RATE_LIMITED: 'RATE_LIMITED'
} as const;
