/** 私有项目在项目接口上对非创建者、非成员一律 404：可读判定交给 projectReadableBy（与主站项目页同一口径）。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { projectReadableBy, projects } from "@prd-lab/core";
import { fakeDb, type FakeDb } from "../../../../../../../packages/core/src/testing/fake-db";

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }));

vi.mock("@prd-lab/core", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  db: new Proxy({}, { get: (_t, p) => h.db.db[p] }),
}));
vi.mock("@/lib/api/auth-guard", () => ({ getSession: async () => ({ userId: "stranger", userName: "s", isAdmin: false }) }));
vi.mock("@/lib/auth/errors", () => ({ AuthenticationUnavailableError: class extends Error {} }));
vi.mock("@/lib/api/owner-check", () => ({}));
vi.mock("@/lib/api/errors", () => import("../../../../../lib/api/errors"));
vi.mock("@/lib/api/pg-errors", () => import("../../../../../lib/api/pg-errors"));

import { GET } from "./route";

const render = (where: unknown) => new MySqlDialect().sqlToQuery(where as Parameters<MySqlDialect["sqlToQuery"]>[0]);

beforeEach(() => {
  h.db = fakeDb([[]]);
});

describe("GET /api/v1/projects/:pid", () => {
  it("查不到可读项目（私有且非创建者、非成员）→ 404，查询条件按当前账户限定可读范围", async () => {
    const res = await GET(new Request("http://app.test/api/v1/projects/p1"), { params: Promise.resolve({ pid: "p1" }) });
    expect(res.status).toBe(404);
    const where = h.db.calls.find((c) => c.method === "where")!.args[0];
    expect(render(where)).toEqual(render(and(eq(projects.id, "p1"), projectReadableBy("stranger"))));
  });
});

describe("projectReadableBy", () => {
  it("未归档，且 team 可见、或本人创建、或仓库项目的在册成员；私有项目不对其他账户开放", () => {
    const q = render(projectReadableBy("u1"));
    expect(q.sql.replace(/\s+/g, " ")).toBe(
      "(`projects`.`archived_at` is null and (`projects`.`visibility` = ? or `projects`.`owner_id` = ? or " +
        "(`projects`.`kind` = ? and EXISTS (SELECT 1 FROM `project_members` WHERE `project_members`.`project_id` = `projects`.`id` " +
        "AND `project_members`.`user_id` = ? AND `project_members`.`removed_at` IS NULL))))",
    );
    expect(q.params).toEqual(["team", "u1", "repo", "u1"]);
  });
});
