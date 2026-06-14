import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { ChatCompletionRequestSchema } from "../../config/schema.js";
import { FusionError } from "../../errors.js";
import { callSingleModel } from "../../fusion/router.js";
import {
  type FusionMetadata,
  type FusionOptions,
  PRESET_NAMES,
  type PresetName,
  VIRTUAL_FUSION_MODELS,
} from "../../fusion/types.js";
import type { ChatMessage, ModelRef, Usage } from "../../providers/base.js";
import type { AppEnv, RouteDeps } from "../types.js";
import { readJsonBody, validateBody } from "../validation.js";

type ChatRequest = ReturnType<typeof parseRequest>;

function parseRequest(data: unknown) {
  return validateBody(ChatCompletionRequestSchema, data);
}

export function createChatHandler(deps: RouteDeps) {
  return async (c: Context<AppEnv>): Promise<Response> => {
    const req = parseRequest(await readJsonBody(c));
    return handleCompletion(deps, c, req, false);
  };
}

/**
 * Shared dispatch for /v1/chat/completions and /v1/fusion/completions.
 *   1. validate (done by caller)
 *   2. stream + fusion → stream_not_supported
 *   3. fusion intent → FusionRouter; else single-model
 */
export async function handleCompletion(
  deps: RouteDeps,
  c: Context<AppEnv>,
  req: ChatRequest,
  forceFusion: boolean,
): Promise<Response> {
  const requestId = c.get("requestId");
  const isFusionModel = req.model.startsWith("fusion/");

  if (isFusionModel && presetFromModel(req.model) === null) {
    throw FusionError.validation(
      `unknown fusion model '${req.model}'. Valid: ${VIRTUAL_FUSION_MODELS.join(", ")}`,
    );
  }

  const fusionSignal = forceFusion || isFusionModel || req.fusion !== undefined;

  if (req.stream === true) {
    if (fusionSignal) {
      throw FusionError.streamNotSupported(
        "streaming is not supported for fusion requests; set stream:false, or use a plain model id for streaming",
      );
    }
    return streamSingleModel(deps, c, req);
  }

  if (!fusionSignal) {
    return singleCompletion(deps, c, req, requestId);
  }

  // ── Fusion path ──
  const preset =
    req.fusion?.preset ?? presetFromModel(req.model) ?? deps.config.fusion.defaultPreset;
  const mode = req.fusion?.mode ?? "forced"; // a fusion/* model or fusion endpoint defaults to forced
  const fusionOpts: FusionOptions = { ...(req.fusion ?? {}), mode };

  const result = await deps.router.run({
    model: req.model,
    messages: req.messages as ChatMessage[],
    fusion: fusionOpts,
    preset,
    temperature: req.temperature,
    maxTokens: req.max_tokens,
    requestId,
  });

  return c.json(
    formatResponse(
      deps,
      requestId,
      result.model,
      result.content,
      result.finishReason,
      result.usage,
      result.metadata,
    ),
  );
}

async function singleCompletion(
  deps: RouteDeps,
  c: Context<AppEnv>,
  req: ChatRequest,
  requestId: string,
): Promise<Response> {
  const single = await callSingleModel(deps.registry, parseModelRef(req.model), {
    messages: req.messages as ChatMessage[],
    temperature: req.temperature,
    maxTokens: req.max_tokens,
  });
  return c.json(
    formatResponse(
      deps,
      requestId,
      single.model,
      single.content,
      single.finishReason,
      single.usage,
      undefined,
    ),
  );
}

function streamSingleModel(deps: RouteDeps, c: Context<AppEnv>, req: ChatRequest): Response {
  const { provider, model } = deps.registry.resolve(parseModelRef(req.model));
  const streamFn = provider.chatCompletionStream?.bind(provider);
  if (!streamFn) {
    throw FusionError.streamNotSupported(`provider '${provider.id}' does not support streaming`);
  }
  const requestId = c.get("requestId");
  const id = `chatcmpl-${requestId}`;
  const created = Math.floor(deps.clock() / 1000);
  const signal = AbortSignal.timeout(deps.config.fusion.timeoutMs);

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({
      data: JSON.stringify(chunk(id, created, model, { role: "assistant" }, null)),
    });
    let finish: string | null = "stop";
    try {
      for await (const part of streamFn({
        model,
        messages: req.messages as ChatMessage[],
        temperature: req.temperature,
        max_tokens: req.max_tokens,
        signal,
      })) {
        if (part.delta) {
          await stream.writeSSE({
            data: JSON.stringify(chunk(id, created, model, { content: part.delta }, null)),
          });
        }
        if (part.finishReason) finish = part.finishReason;
      }
    } catch (err) {
      deps.logger.warn("stream failed", { requestId, error: (err as Error).message });
      await stream.writeSSE({
        data: JSON.stringify({
          error: { message: (err as Error).message, type: "provider_error" },
        }),
      });
    }
    await stream.writeSSE({ data: JSON.stringify(chunk(id, created, model, {}, finish)) });
    await stream.writeSSE({ data: "[DONE]" });
  });
}

// ── helpers ──

export function presetFromModel(model: string): PresetName | null {
  if (!model.startsWith("fusion/")) return null;
  const p = model.slice("fusion/".length);
  return (PRESET_NAMES as readonly string[]).includes(p) ? (p as PresetName) : null;
}

/** "provider:model" → {provider, model}; otherwise treat as a named-model id. */
export function parseModelRef(model: string): ModelRef {
  const i = model.indexOf(":");
  if (i > 0) return { provider: model.slice(0, i), model: model.slice(i + 1) };
  return { provider: model, model };
}

function formatResponse(
  deps: RouteDeps,
  requestId: string,
  model: string,
  content: string,
  finishReason: string,
  usage: Usage,
  metadata: FusionMetadata | undefined,
): Record<string, unknown> {
  const resp: Record<string, unknown> = {
    id: `chatcmpl-${requestId}`,
    object: "chat.completion",
    created: Math.floor(deps.clock() / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finishReason }],
    usage,
  };
  if (metadata) resp.fusion_metadata = metadata;
  return resp;
}

function chunk(
  id: string,
  created: number,
  model: string,
  delta: Record<string, unknown>,
  finishReason: string | null,
): Record<string, unknown> {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}
