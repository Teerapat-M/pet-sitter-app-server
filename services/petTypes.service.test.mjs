import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPetTypesRepository } from "../repositories/petTypes.repository.mjs";
import { createPetTypesService } from "./petTypes.service.mjs";

/** pg.Pool#query reads `this`; extracting `const { query } = pool` unbinds it. */
function fakePool(rows) {
  return {
    rows,
    async query() {
      if (this == null || !Array.isArray(this.rows)) {
        throw new TypeError("Pool.query called without this");
      }
      return { rows: this.rows };
    },
  };
}

describe("createPetTypesRepository", () => {
  it("fails if query is destructured off a Pool (unbound this)", async () => {
    const db = fakePool([{ id: 1, name: "Dog" }]);
    const { query } = db;
    await assert.rejects(() => query("SELECT 1"), /without this/);
  });

  it("keeps this when query is a Pool method (not a bare mock)", async () => {
    const db = fakePool([
      { id: 1, name: "Dog" },
      { id: 2, name: "Cat" },
    ]);
    const repo = createPetTypesRepository({
      query: (...args) => db.query(...args),
    });
    assert.deepEqual(await repo.findAll(), [
      { id: 1, name: "Dog" },
      { id: 2, name: "Cat" },
    ]);
  });

  it("selects id, name from pet_types ordered by id (mocked db)", async () => {
    const calls = [];
    const rows = [
      { id: 1, name: "Dog" },
      { id: 2, name: "Cat" },
      { id: 3, name: "Bird" },
      { id: 4, name: "Rabbit" },
    ];
    const repo = createPetTypesRepository({
      query: async (sql) => {
        calls.push(sql);
        return { rows };
      },
    });

    const result = await repo.findAll();

    assert.equal(calls.length, 1);
    assert.match(calls[0], /FROM public\.pet_types/i);
    assert.match(calls[0], /SELECT id,\s*name/i);
    assert.match(calls[0], /ORDER BY id/i);
    assert.deepEqual(result, rows);
  });
});

describe("createPetTypesService", () => {
  it("returns { data }-shaped rows from the mocked repository", async () => {
    const service = createPetTypesService({
      findAll: async () => [
        { id: 1, name: "Dog" },
        { id: 2, name: "Cat" },
      ],
    });

    assert.deepEqual(await service.list(), [
      { id: 1, name: "Dog" },
      { id: 2, name: "Cat" },
    ]);
  });
});
