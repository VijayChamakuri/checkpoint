import Anthropic from "@anthropic-ai/sdk";

export class LLMCallFailure extends Error {
  constructor(
    message: string,
    public readonly kind: "retryable-exhausted" | "malformed" | "refusal",
  ) {
    super(message);
    this.name = "LLMCallFailure";
  }
}

const MAX_RETRIES = 2;
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5-20250929";

/**
 * Wraps the LLM API call with the LLMCallFailure taxonomy: timeout/429
 * retry with bounded backoff (same 2-attempt bound as RecoverableCondition);
 * a malformed/empty response or an explicit refusal is treated as equivalent
 * to a HardFailure for the discovery loop -- escalate rather than guess at a
 * corrupted or refused response.
 */
export async function callModel(
  client: Anthropic,
  params: Anthropic.MessageCreateParamsNonStreaming,
): Promise<Anthropic.Message> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await client.messages.create(params);
      if (!response.content || response.content.length === 0) {
        throw new LLMCallFailure("model returned an empty response", "malformed");
      }
      return response;
    } catch (error) {
      lastError = error;
      if (error instanceof LLMCallFailure) throw error;
      const retryable = isRetryable(error);
      if (!retryable || attempt === MAX_RETRIES) {
        throw new LLMCallFailure(
          `LLM API call failed after ${attempt + 1} attempt(s): ${String(error)}`,
          "retryable-exhausted",
        );
      }
      await sleep(2 ** attempt * 500);
    }
  }
  throw new LLMCallFailure(`unreachable: ${String(lastError)}`, "retryable-exhausted");
}

function isRetryable(error: unknown): boolean {
  if (error instanceof Anthropic.APIError) {
    return error.status === 429 || error.status === 408 || error.status === 529 || error.status === undefined;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Export it in your shell or a local .env file (never commit it) before running a discovery run.",
    );
  }
  return new Anthropic({ apiKey });
}

export { MODEL };
