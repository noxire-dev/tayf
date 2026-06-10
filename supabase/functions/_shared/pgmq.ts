// supabase/functions/_shared/pgmq.ts
//
// Thin RPC wrapper over the `pgmq` extension functions. Migration 024 grants
// service-role EXECUTE on `pgmq.send / read / delete / archive` and the
// service-role client routes through PostgREST so we expose them as
// `client.schema('pgmq').rpc('<fn>', args)`.
//
// pgmq's row shape (from `pgmq.read`):
//   msg_id      bigint
//   read_ct     integer    -- how many times read (visibility-timeout retries)
//   enqueued_at timestamptz
//   vt          timestamptz
//   message     jsonb

import type { SupabaseClient } from "./supabase.ts";

export interface PgmqMessage<T = unknown> {
  msg_id: number;
  read_ct: number;
  enqueued_at: string;
  vt: string;
  message: T;
}

/**
 * Reads up to `qty` messages from `queue`, leasing them for `vt` seconds.
 * Returns [] if the queue is empty.
 */
export async function readBatch<T = unknown>(
  client: SupabaseClient,
  queue: string,
  vt = 60,
  qty = 50,
): Promise<PgmqMessage<T>[]> {
  const { data, error } = await client.schema("pgmq").rpc("read", {
    queue_name: queue,
    vt,
    qty,
  });
  if (error) {
    throw new Error(`pgmq.read(${queue}): ${error.message}`);
  }
  return (data ?? []) as PgmqMessage<T>[];
}

/**
 * Archives a single message — moves it to the archive table and removes it
 * from the live queue. Used on successful processing.
 */
export async function archive(
  client: SupabaseClient,
  queue: string,
  msgId: number,
): Promise<void> {
  const { error } = await client.schema("pgmq").rpc("archive", {
    queue_name: queue,
    msg_id: msgId,
  });
  if (error) {
    throw new Error(`pgmq.archive(${queue}, ${msgId}): ${error.message}`);
  }
}

/**
 * Permanently deletes a message from the queue WITHOUT archiving.
 * Operational escape hatch only — the consumers archive poison messages
 * (audit S12) so the payload survives in `pgmq.a_<queue>` as the audit
 * trail; nothing in the drain paths deletes anymore.
 */
export async function deleteMessage(
  client: SupabaseClient,
  queue: string,
  msgId: number,
): Promise<void> {
  const { error } = await client.schema("pgmq").rpc("delete", {
    queue_name: queue,
    msg_id: msgId,
  });
  if (error) {
    throw new Error(`pgmq.delete(${queue}, ${msgId}): ${error.message}`);
  }
}

/**
 * Best-effort queue depth probe via `pgmq.metrics` (granted to
 * service_role in migration 024). Returns null on any failure — depth
 * sampling is observability garnish and must never fail a drain.
 */
export async function queueDepth(
  client: SupabaseClient,
  queue: string,
): Promise<number | null> {
  const { data, error } = await client.schema("pgmq").rpc("metrics", {
    queue_name: queue,
  });
  if (error) return null;
  const row = (Array.isArray(data) ? data[0] : data) as
    | { queue_length?: number }
    | null;
  const len = row?.queue_length;
  return typeof len === "number" ? len : null;
}

/**
 * Enqueue a JSON-serialisable payload. Returns the new msg_id.
 */
export async function send(
  client: SupabaseClient,
  queue: string,
  payload: unknown,
): Promise<number> {
  const { data, error } = await client.schema("pgmq").rpc("send", {
    queue_name: queue,
    message: payload,
  });
  if (error) {
    throw new Error(`pgmq.send(${queue}): ${error.message}`);
  }
  // pgmq.send returns a single bigint (the msg_id).
  if (Array.isArray(data) && data.length > 0) return Number(data[0]);
  if (typeof data === "number") return data;
  return Number(data);
}
