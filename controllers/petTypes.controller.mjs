import { petTypesService } from "../services/petTypes.service.mjs";

export const petTypesController = {
  async list(_req, res, next) {
    try {
      const petTypes = await petTypesService.list();
      res.status(200).json({ data: petTypes });
    } catch (error) {
      next(error);
    }
  },
};
