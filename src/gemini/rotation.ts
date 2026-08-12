import { createHash } from "crypto";
import { log } from "../utils/logger.util";

export type Tier = "opus" | "sonnet" | "haiku";

export interface Combination {
  readonly key: string;
  readonly model: string;
  readonly keyFingerprint: string;
}

export interface TierModels {
  opus: readonly string[];
  sonnet: readonly string[];
  haiku: readonly string[];
}

export interface RotationConfig {
  keys: readonly string[];
  tierModels: TierModels;
  cooldownMs: number;
}

export class AllCombinationsExhaustedError extends Error {
  constructor(tier: Tier, totalCombinations: number) {
    super(
      `All ${totalCombinations} key/model combinations exhausted for tier "${tier}". ` +
      `All Gemini endpoints are currently rate-limited or unavailable.`
    );
    this.name = "AllCombinationsExhaustedError";
  }
}

export class GeminiUpstreamError extends Error {
  constructor(
    public readonly status: number,
    public readonly responseBody: unknown,
  ) {
    super(`Gemini ${status}: ${JSON.stringify(responseBody)}`);
    this.name = "GeminiUpstreamError";
  }
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status);
}

export function keyFingerprint(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

export function buildCombinations(
  keys: readonly string[],
  models: readonly string[],
): Combination[] {
  const combos: Combination[] = [];
  for (const key of keys) {
    const fp = keyFingerprint(key);
    for (const model of models) {
      combos.push({ key, model, keyFingerprint: fp });
    }
  }
  return combos;
}

export class CooldownTracker {
  private readonly state = new Map<string, number>();

  constructor(private readonly cooldownMs: number) {}

  private makeKey(combo: Combination): string {
    return `${combo.keyFingerprint}:${combo.model}`;
  }

  markFailed(combo: Combination): void {
    this.state.set(this.makeKey(combo), Date.now() + this.cooldownMs);
  }

  markHealthy(combo: Combination): void {
    this.state.delete(this.makeKey(combo));
  }

  isInCooldown(combo: Combination): boolean {
    const expiry = this.state.get(this.makeKey(combo));
    if (expiry === undefined) return false;
    if (Date.now() >= expiry) {
      this.state.delete(this.makeKey(combo));
      return false;
    }
    return true;
  }

  get size(): number {
    return this.state.size;
  }

  clear(): void {
    this.state.clear();
  }
}

export class GeminiRotationManager {
  private readonly pools: Record<Tier, readonly Combination[]>;
  private readonly cooldown: CooldownTracker;

  constructor(config: RotationConfig) {
    const { keys, tierModels, cooldownMs } = config;

    if (keys.length === 0) {
      throw new Error("At least one GEMINI API key is required.");
    }

    this.cooldown = new CooldownTracker(cooldownMs);
    this.pools = {
      opus: buildCombinations(keys, tierModels.opus),
      sonnet: buildCombinations(keys, tierModels.sonnet),
      haiku: buildCombinations(keys, tierModels.haiku),
    };

    for (const tier of ["opus", "sonnet", "haiku"] as const) {
      if (this.pools[tier].length === 0) {
        log("error", `No models configured for tier "${tier}" — requests to this tier will fail.`);
      }
    }
  }

  getPool(tier: Tier): readonly Combination[] {
    return this.pools[tier];
  }

  getCooldownTracker(): CooldownTracker {
    return this.cooldown;
  }

  async executeWithRotation(
    tier: Tier,
    requestFn: (apiKey: string, model: string) => Promise<Response>,
  ): Promise<{ response: Response; model: string }> {
    const pool = this.pools[tier];
    if (pool.length === 0) {
      throw new AllCombinationsExhaustedError(tier, 0);
    }

    const healthy: Combination[] = [];
    const coolingDown: Combination[] = [];
    for (const combo of pool) {
      if (this.cooldown.isInCooldown(combo)) {
        coolingDown.push(combo);
      } else {
        healthy.push(combo);
      }
    }
    const ordered = [...healthy, ...coolingDown];
    const total = ordered.length;

    for (let i = 0; i < total; i++) {
      const combo = ordered[i];
      const attempt = i + 1;

      log("info", `Gemini request: tier=${tier} key=${combo.keyFingerprint} model=${combo.model} attempt=${attempt}/${total}`);

      let response: Response;
      try {
        response = await requestFn(combo.key, combo.model);
      } catch (err: unknown) {
        log("error", `Gemini network error: tier=${tier} key=${combo.keyFingerprint} model=${combo.model} error=${err instanceof Error ? err.message : String(err)}`);
        this.cooldown.markFailed(combo);
        continue;
      }

      if (response.ok) {
        log("info", `Gemini request succeeded: tier=${tier} key=${combo.keyFingerprint} model=${combo.model}`);
        this.cooldown.markHealthy(combo);
        return { response, model: combo.model };
      }

      const status = response.status;

      if (isRetryableStatus(status)) {
        log("info", `Gemini rate limited: tier=${tier} key=${combo.keyFingerprint} model=${combo.model} status=${status} cooldown=${this.cooldown["cooldownMs"] / 1000}s`);
        try { await response.text(); } catch { /* ignore */ }
        this.cooldown.markFailed(combo);
        log("info", `Rotating Gemini: tier=${tier} ${combo.keyFingerprint}+${combo.model} -> ${i + 1 < total ? `${ordered[i + 1].keyFingerprint}+${ordered[i + 1].model}` : "exhausted"}`);
        continue;
      }

      let body: unknown;
      try { body = await response.json(); } catch { body = await response.text().catch(() => ""); }
      throw new GeminiUpstreamError(status, body);
    }

    throw new AllCombinationsExhaustedError(tier, total);
  }
}
