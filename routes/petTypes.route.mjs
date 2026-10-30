import { Router } from "express";
import { petTypesController } from "../controllers/petTypes.controller.mjs";

const petTypesRouter = Router();

/**
 * @openapi
 * /api/pet-types:
 *   get:
 *     summary: List pet types
 *     tags: [Pet types]
 *     responses:
 *       200:
 *         description: Pet types (id, name) ordered by id
 */
petTypesRouter.get("/", petTypesController.list);

export default petTypesRouter;
