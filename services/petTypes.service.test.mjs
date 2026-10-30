import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPetTypesRepository } from "../repositories/petTypes.repository.mjs";
import { createPetTypesService } from "./petTypes.service.mjs";

describe("createPetTypesRepository", () => {
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
