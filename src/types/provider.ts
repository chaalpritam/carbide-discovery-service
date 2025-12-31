import { z } from 'zod';
import { ReputationScore, ReputationScoreSchema } from './reputation.js';

/**
 * Provider tier with associated pricing and uptime guarantees
 */
export enum ProviderTier {
  Home = 'Home',                    // $0.002/GB, 95% uptime
  Professional = 'Professional',     // $0.004/GB, 99% uptime
  Enterprise = 'Enterprise',         // $0.008/GB, 99.9% uptime
  GlobalCDN = 'GlobalCDN'           // $0.012/GB, 99.99% uptime
}

/**
 * Geographic regions for provider location
 */
export enum Region {
  NorthAmerica = 'NorthAmerica',
  Europe = 'Europe',
  Asia = 'Asia',
  SouthAmerica = 'SouthAmerica',
  Africa = 'Africa',
  Oceania = 'Oceania'
}

/**
 * Provider represents a storage provider in the marketplace
 */
export interface Provider {
  id: string;                       // UUID
  name: string;                     // Human-readable name
  tier: ProviderTier;               // Provider tier
  region: Region;                   // Geographic location
  endpoint: string;                 // API endpoint URL
  available_capacity: number;       // Available storage (bytes)
  total_capacity: number;           // Total storage capacity (bytes)
  price_per_gb_month: string;       // Price as decimal string
  reputation: ReputationScore;      // Reputation metrics
  last_seen: string;                // ISO 8601 timestamp
  metadata: Record<string, string>; // Provider-specific metadata
}

/**
 * ProviderAnnouncement message for provider registration
 */
export interface ProviderAnnouncement {
  provider: Provider;               // Full provider info
  endpoint: string;                 // Direct communication endpoint
  supported_versions: string[];     // Protocol versions (e.g., ["1.0"])
  public_key: string | null;        // Public key for verification
}

/**
 * ProviderListRequest for searching/filtering providers
 */
export interface ProviderListRequest {
  region?: Region | null;           // Optional region filter
  tier?: ProviderTier | null;       // Optional tier filter
  limit?: number | null;            // Max providers to return
  min_reputation?: string | null;   // Minimum reputation score
}

/**
 * ProviderListResponse with providers and pagination info
 */
export interface ProviderListResponse {
  providers: Provider[];            // Array of matching providers
  total_count: number;              // Total matching providers
  has_more: boolean;                // Pagination flag
}

/**
 * Zod schemas for validation
 */
export const ProviderTierSchema = z.nativeEnum(ProviderTier);
export const RegionSchema = z.nativeEnum(Region);

export const ProviderSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  tier: ProviderTierSchema,
  region: RegionSchema,
  endpoint: z.string().url(),
  available_capacity: z.number().int().min(0),
  total_capacity: z.number().int().min(0),
  price_per_gb_month: z.string(),
  reputation: ReputationScoreSchema,
  last_seen: z.string().datetime(),
  metadata: z.record(z.string())
});

export const ProviderAnnouncementSchema = z.object({
  provider: ProviderSchema,
  endpoint: z.string().url(),
  supported_versions: z.array(z.string()),
  public_key: z.string().nullable()
});

export const ProviderListRequestSchema = z.object({
  region: RegionSchema.nullable().optional(),
  tier: ProviderTierSchema.nullable().optional(),
  limit: z.number().int().positive().nullable().optional(),
  min_reputation: z.string().nullable().optional()
});

export const ProviderListResponseSchema = z.object({
  providers: z.array(ProviderSchema),
  total_count: z.number().int().min(0),
  has_more: z.boolean()
});
