import { z } from 'zod';

export interface User {
  id: string;
  wallet_address: string;
  display_name: string | null;
  public_key: string | null;
  created_at: string;
  last_seen: string;
  is_active: boolean;
  metadata: Record<string, string>;
}

const ethAddressRegex = /^0x[0-9a-fA-F]{40}$/;

export const UserRegistrationSchema = z.object({
  wallet_address: z.string().regex(ethAddressRegex, 'Invalid Ethereum address'),
  display_name: z.string().min(1).max(100).optional(),
  public_key: z.string().optional(),
  metadata: z.record(z.string()).optional(),
});

export const UserUpdateSchema = z.object({
  display_name: z.string().min(1).max(100).optional(),
  public_key: z.string().optional(),
  metadata: z.record(z.string()).optional(),
});

export type UserRegistration = z.infer<typeof UserRegistrationSchema>;
export type UserUpdate = z.infer<typeof UserUpdateSchema>;
