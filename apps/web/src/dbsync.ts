/**
 * Shared-database mode: the app mirrors the database workspace through the
 * model REST API. Loads via GET /api/v1/workspace; every local command
 * (including undo/redo inverses) is pushed through POST /api/v1/commands —
 * the same validated bus path as every other client. A poll/sync pulls
 * remote changes back.
 */

import type { Command, WorkspaceData } from "@atlas/core";
import { sessionToken } from "./supabase";

const DEV_TOKEN_KEY = "atlas.api.token";

/** GitHub session token in the hosted app; a manually-set token for dev/scripts. */
export async function apiToken(): Promise<string | null> {
  return (await sessionToken()) ?? localStorage.getItem(DEV_TOKEN_KEY);
}

const api = (path: string): string => `${window.location.origin}/api/v1${path}`;

async function request(path: string, token: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(api(path), {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    let message = `${response.status}`;
    try {
      message = ((await response.json()) as { error?: string }).error ?? message;
    } catch {
      /* keep status text */
    }
    throw new Error(`Database sync: ${message}`);
  }
  return response;
}

export async function fetchDbWorkspace(token: string): Promise<WorkspaceData> {
  return (await (await request("/workspace", token)).json()) as WorkspaceData;
}

// Pushes are serialised so commands arrive in dispatch order.
let queue: Promise<void> = Promise.resolve();

export function pushCommand(
  token: string,
  command: Command,
  onError: (message: string) => void,
): void {
  queue = queue
    .then(async () => {
      await request("/commands", token, {
        method: "POST",
        body: JSON.stringify({ label: "UI", commands: [command] }),
      });
    })
    .catch((err) => onError(err instanceof Error ? err.message : String(err)));
}

/** Resolves when all queued pushes have settled (used before pulling). */
export function pushesSettled(): Promise<void> {
  return queue;
}
