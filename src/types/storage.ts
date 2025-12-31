import { z } from 'zod';
import { Region, RegionSchema } from './provider.js';

/**
 * ContentHash - BLAKE3 or SHA256 hash as hex string (64 characters)
 */
export type ContentHash = string;
export type FileId = ContentHash;

/**
 * Provider requirements for storage requests
 */
export interface ProviderRequirements {
  min_uptime: string;               // Decimal as string (e.g., "0.999" for 99.9%)
  preferred_regions: Region[];      // Array of preferred regions
  exclude_home_providers: boolean;  // Exclude Home tier?
  require_backup_power: boolean;    // Require UPS?
  max_latency_ms: number;           // Maximum latency in milliseconds
  min_reputation: string;           // Minimum reputation (decimal string)
}

/**
 * File metadata structure
 */
export interface File {
  id: FileId;                       // ContentHash as hex string
  name: string;                     // Original filename
  size: number;                     // File size in bytes
  mime_type: string;                // MIME type
  chunks: ContentHash[];            // Array of chunk hashes
  created_at: string;               // ISO 8601 timestamp
  metadata: Record<string, string>; // Optional metadata
}

/**
 * FileChunk for chunked file transfer
 */
export interface FileChunk {
  hash: ContentHash;                // ContentHash as hex string
  data: number[];                   // Byte array (up to 64MB)
  offset: number;                   // Position in file
  total_size: number;               // Total file size
}

/**
 * Encryption information for files
 */
export interface EncryptionInfo {
  algorithm: string;                // e.g., "AES-256-GCM"
  key_derivation: KeyDerivationInfo | null;
  is_encrypted: boolean;
}

/**
 * Key derivation information
 */
export interface KeyDerivationInfo {
  method: string;                   // e.g., "PBKDF2"
  salt: string;                     // Salt as string
  iterations: number;               // Number of iterations
}

/**
 * Storage request from client
 */
export interface StorageRequest {
  id: string;                       // UUID
  file_id: FileId;                  // FileId (ContentHash as hex)
  replication_factor: number;       // 1-10 copies
  max_price_per_gb_month: string;   // Decimal as string
  requirements: ProviderRequirements;
  created_at: string;               // ISO 8601 timestamp
  metadata: Record<string, string>; // Optional client metadata
}

/**
 * Contract status enum
 */
export enum ContractStatus {
  Active = 'Active',
  Completed = 'Completed',
  Cancelled = 'Cancelled',
  Failed = 'Failed'
}

/**
 * Storage contract between client and provider
 */
export interface StorageContract {
  id: string;                       // UUID
  request_id: string;               // UUID - references StorageRequest
  file_id: FileId;                  // FileId (ContentHash as hex)
  provider_id: string;              // ProviderId (UUID)
  price_per_gb_month: string;       // Decimal as string
  duration_months: number;          // Contract duration
  started_at: string;               // ISO 8601 timestamp
  status: ContractStatus;           // Contract status
  last_proof_at: string | null;     // ISO 8601 timestamp or null
}

/**
 * Zod schemas for validation
 */
export const ProviderRequirementsSchema = z.object({
  min_uptime: z.string(),
  preferred_regions: z.array(RegionSchema),
  exclude_home_providers: z.boolean(),
  require_backup_power: z.boolean(),
  max_latency_ms: z.number().int().positive(),
  min_reputation: z.string()
});

export const FileSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number().int().min(0),
  mime_type: z.string(),
  chunks: z.array(z.string()),
  created_at: z.string().datetime(),
  metadata: z.record(z.string())
});

export const StorageRequestSchema = z.object({
  id: z.string().uuid(),
  file_id: z.string(),
  replication_factor: z.number().int().min(1).max(10),
  max_price_per_gb_month: z.string(),
  requirements: ProviderRequirementsSchema,
  created_at: z.string().datetime(),
  metadata: z.record(z.string())
});

export const ContractStatusSchema = z.nativeEnum(ContractStatus);

export const StorageContractSchema = z.object({
  id: z.string().uuid(),
  request_id: z.string().uuid(),
  file_id: z.string(),
  provider_id: z.string().uuid(),
  price_per_gb_month: z.string(),
  duration_months: z.number().int().positive(),
  started_at: z.string().datetime(),
  status: ContractStatusSchema,
  last_proof_at: z.string().datetime().nullable()
});
