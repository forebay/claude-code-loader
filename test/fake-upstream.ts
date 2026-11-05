import { createServer } from "node:http";
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from "node:http";

export const UPSTREAM_TEXT = "Hello from the fake upstream.";

/** One request the fake upstream received. */
export interface ReceivedRequest {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

/** A loopback stand-in for api.anthropic.com, answering the Messages API and recording every request. */
export interface FakeUpstream {
  address: string;
  received: ReceivedRequest[];
  close(): Promise<void>;
}

const MODEL = "claude-fake-upstream";

function messageOf(): Record<string, unknown> {
  return {
    id: "msg_fake_upstream",
    type: "message",
    role: "assistant",
    model: MODEL,
    content: [{ type: "text", text: UPSTREAM_TEXT }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

function streamEvents(): Array<[string, Record<string, unknown>]> {
  return [
    ["message_start", { type: "message_start", message: { ...messageOf(), content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: UPSTREAM_TEXT } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } }],
    ["message_stop", { type: "message_stop" }],
  ];
}

function isStreaming(body: string): boolean {
  try {
    return (JSON.parse(body) as { stream?: unknown }).stream === true;
  } catch {
    return false;
  }
}

function answerMessages(body: string, response: ServerResponse): void {
  if (!isStreaming(body)) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(messageOf()));
    return;
  }
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  for (const [event, data] of streamEvents()) response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  response.end();
}

function answer(request: IncomingMessage, body: string, response: ServerResponse): void {
  const path = (request.url ?? "").split("?")[0];
  if (request.method === "POST" && path === "/v1/messages") return answerMessages(body, response);
  if (request.method === "POST" && path === "/v1/messages/count_tokens") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ input_tokens: 1 }));
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ type: "error", error: { type: "not_found_error", message: `the fake upstream has no ${path}` } }));
}

function listening(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) resolve(`http://127.0.0.1:${address.port}`);
      else reject(new Error("the fake upstream has no port"));
    });
  });
}

/** Starts the fake upstream on a free loopback port. */
export async function startFakeUpstream(): Promise<FakeUpstream> {
  const received: ReceivedRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      received.push({ method: request.method ?? "", url: request.url ?? "", headers: request.headers, body });
      answer(request, body, response);
    });
  });
  const address = await listening(server);
  return {
    address,
    received,
    close: () => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}
