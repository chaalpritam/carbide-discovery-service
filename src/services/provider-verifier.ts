export interface VerificationResult {
  reachable: boolean;
  responseTimeMs: number;
  reportedCapacity: number | null;
  errors: string[];
}

export class ProviderVerifier {
  private timeoutMs: number;

  constructor(timeoutMs = 10000) {
    this.timeoutMs = timeoutMs;
  }

  async verifyEndpoint(endpoint: string): Promise<VerificationResult> {
    const errors: string[] = [];
    const start = Date.now();

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const healthUrl = `${endpoint}/api/v1/health`;
      const response = await fetch(healthUrl, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });
      clearTimeout(timer);

      const responseTimeMs = Date.now() - start;

      if (!response.ok) {
        errors.push(`Health endpoint returned ${response.status}`);
        return { reachable: false, responseTimeMs, reportedCapacity: null, errors };
      }

      const body = await response.json() as Record<string, unknown>;
      const reportedCapacity = typeof body.available_storage === 'number' ? body.available_storage : null;

      return { reachable: true, responseTimeMs, reportedCapacity, errors };
    } catch (err) {
      const responseTimeMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to reach endpoint: ${message}`);
      return { reachable: false, responseTimeMs, reportedCapacity: null, errors };
    }
  }

  async verifyCapacity(endpoint: string, claimedCapacity: number): Promise<VerificationResult> {
    const result = await this.verifyEndpoint(endpoint);
    if (!result.reachable) return result;

    if (result.reportedCapacity !== null && result.reportedCapacity < claimedCapacity * 0.5) {
      result.errors.push(
        `Reported capacity (${result.reportedCapacity}) is less than 50% of claimed (${claimedCapacity})`
      );
    }

    return result;
  }
}
