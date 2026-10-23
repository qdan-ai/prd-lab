import { and, isNull, sql } from "drizzle-orm";
import { repoVersions, snapshotInAudience, snapshots } from "@prd-lab/core";

/** Share snapshot selectors also cover repository snapshots: withdrawal must not be bypassed by sid. */
export function sharedSnapshotAvailable() {
  return and(
    isNull(snapshots.archivedAt),
    snapshotInAudience("guest"),
    sql`NOT EXISTS (SELECT 1 FROM ${repoVersions}
      WHERE ${repoVersions.snapshotId} = ${snapshots.id}
      AND ${repoVersions.withdrawnAt} IS NOT NULL)`,
  );
}
