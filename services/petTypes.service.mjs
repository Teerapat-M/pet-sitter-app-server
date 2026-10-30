import { petTypesRepository } from "../repositories/petTypes.repository.mjs";

export function createPetTypesService({
  findAll = petTypesRepository.findAll.bind(petTypesRepository),
} = {}) {
  return {
    async list() {
      return findAll();
    },
  };
}

export const petTypesService = createPetTypesService();
