import { z } from 'zod';

/**
 * ReputationScore represents a provider's trustworthiness metrics
 * Scores range from 0.0 to 1.0 (represented as strings for precision)
 */
export interface ReputationScore {
  overall: string;              // Weighted average of all metrics (0.0-1.0)
  uptime: string;               // Uptime percentage (25% weight)
  data_integrity: string;       // Data integrity score (25% weight)
  response_time: string;        // Response time score (20% weight)
  contract_compliance: string;  // Contract compliance score (20% weight)
  community_feedback: string;   // Community feedback score (10% weight)
  contracts_completed: number;  // Total contracts completed
  last_updated: string;         // ISO 8601 timestamp
}

/**
 * Default reputation score for new providers
 */
export const DEFAULT_REPUTATION: ReputationScore = {
  overall: '0.5',
  uptime: '1.0',
  data_integrity: '1.0',
  response_time: '0.8',
  contract_compliance: '1.0',
  community_feedback: '0.5',
  contracts_completed: 0,
  last_updated: new Date().toISOString()
};

/**
 * Zod schema for ReputationScore validation
 */
export const ReputationScoreSchema = z.object({
  overall: z.string(),
  uptime: z.string(),
  data_integrity: z.string(),
  response_time: z.string(),
  contract_compliance: z.string(),
  community_feedback: z.string(),
  contracts_completed: z.number().int().min(0),
  last_updated: z.string().datetime()
});
