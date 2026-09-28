import type { McdtTable, QualityReport, Snapshot } from "@sns-conv/schema";
import { useEffect, useState } from "react";

let snapshotPromise: Promise<Snapshot> | null = null;
let mcdtPromise: Promise<McdtTable> | null = null;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function loadSnapshot(): Promise<Snapshot> {
  snapshotPromise ??= getJson<Snapshot>("/data/latest.json").catch((e: unknown) => {
    snapshotPromise = null; // uma falha não fica em cache: "tentar de novo" volta a pedir
    throw e;
  });
  return snapshotPromise;
}
export function loadMcdt(): Promise<McdtTable> {
  mcdtPromise ??= getJson<McdtTable>("/data/mcdt-codes.json").catch((e: unknown) => {
    mcdtPromise = null;
    throw e;
  });
  return mcdtPromise;
}
export function loadReport(): Promise<QualityReport> {
  return getJson<QualityReport>("/data/report-latest.json");
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, set] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    let alive = true;
    set({ loading: true });
    fn().then(
      (data) => alive && set({ data, loading: false }),
      (e: unknown) =>
        alive && set({ error: e instanceof Error ? e.message : String(e), loading: false }),
    );
    return () => {
      alive = false;
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: deps são explícitas
  }, deps);
  return state;
}
