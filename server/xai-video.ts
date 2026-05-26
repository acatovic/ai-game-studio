// Image-to-video generation via OpenRouter /api/v1/videos with polling.
// Model: x-ai/grok-imagine-video
// Flow: submit job → poll polling_url every few seconds → on `completed`, return unsigned_urls[0]
//
// The downloader in server/files.ts fetches the returned URL without auth, which works for
// the unsigned_urls returned by OpenRouter on completion. If unsigned_urls is missing we
// fall back to the authenticated content endpoint and inline the auth via a query param —
// see resolveDownloadableUrl below.

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const MODEL = "x-ai/grok-imagine-video";

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 100; // ~5 min cap

const CHROMA_DIRECTIVE =
  "Maintain the exact same flat solid pure chroma green background, " +
  "hex #00b140, throughout the entire clip. No background changes, no " +
  "environmental elements, no shadows on the background, no camera movement. " +
  "The subject animates against the uniform green backdrop.";

type JobStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

interface VideoJob {
  id: string;
  status: JobStatus;
  polling_url?: string;
  unsigned_urls?: string[];
  generation_id?: string;
  error?: string | { message?: string };
}

interface ErrorResponse {
  error?: string | { message?: string };
}

export interface VideoDownload {
  url: string;
  headers?: Record<string, string>;
}

export async function generateSpriteMotionVideo(
  image: string,
  text: string,
  duration = 2,
): Promise<VideoDownload> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const fullText = `${text.trim()}\n\n${CHROMA_DIRECTIVE}`;

  const submitRes = await fetch(`${OPENROUTER_BASE}/videos`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      prompt: fullText,
      duration,
      input_references: [
        {
          type: "image_url",
          image_url: { url: image },
        },
      ],
    }),
  });

  let job = (await submitRes.json().catch(() => ({}))) as VideoJob & ErrorResponse;
  if (!submitRes.ok) {
    throw new Error(`OpenRouter video submit failed: ${extractError(job, submitRes.status)}`);
  }
  if (!job.id) {
    throw new Error("OpenRouter video submit returned no job id");
  }

  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    if (job.status === "completed") break;
    if (
      job.status === "failed" ||
      job.status === "cancelled" ||
      job.status === "expired"
    ) {
      throw new Error(
        `OpenRouter video ${job.status}: ${extractError(job, 200)}`,
      );
    }

    await sleep(POLL_INTERVAL_MS);

    const pollUrl = job.polling_url
      ? new URL(job.polling_url, "https://openrouter.ai").toString()
      : `${OPENROUTER_BASE}/videos/${job.id}`;

    const pollRes = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    job = (await pollRes.json().catch(() => ({}))) as VideoJob & ErrorResponse;
    if (!pollRes.ok) {
      throw new Error(
        `OpenRouter video poll failed: ${extractError(job, pollRes.status)}`,
      );
    }
  }

  if (job.status !== "completed") {
    throw new Error(`OpenRouter video did not complete in time (last status: ${job.status})`);
  }

  return resolveDownloadable(job, apiKey);
}

function resolveDownloadable(job: VideoJob, apiKey: string): VideoDownload {
  const authHeaders = { Authorization: `Bearer ${apiKey}` };
  const unsigned = job.unsigned_urls?.[0];
  if (unsigned) {
    // openrouter.ai-hosted unsigned URLs still need the bearer token. Send the key only
    // to openrouter so it can't leak to a third-party CDN.
    return isOpenRouterHost(unsigned)
      ? { url: unsigned, headers: authHeaders }
      : { url: unsigned };
  }
  return {
    url: `${OPENROUTER_BASE}/videos/${job.id}/content?index=0`,
    headers: authHeaders,
  };
}

function isOpenRouterHost(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "openrouter.ai" || h.endsWith(".openrouter.ai");
  } catch {
    return false;
  }
}

function extractError(payload: ErrorResponse, status: number): string {
  if (typeof payload.error === "string") return payload.error;
  if (payload.error?.message) return payload.error.message;
  return `HTTP ${status}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
