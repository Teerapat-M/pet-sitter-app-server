import { walksService } from "../services/walks.service.mjs";
import { subscribeWalkEvents } from "../services/walkEvents.mjs";

export const walksController = {
  async startWalk(req, res, next) {
    try {
      const walk = await walksService.startWalk(req.user.id, req.params.id);
      return res.status(200).json({ data: walk });
    } catch (error) {
      next(error);
    }
  },

  async postPoints(req, res, next) {
    try {
      const result = await walksService.postPoints(
        req.user.id,
        req.params.id,
        req.body
      );
      return res.status(200).json({ data: result });
    } catch (error) {
      next(error);
    }
  },

  async endWalk(req, res, next) {
    try {
      const walk = await walksService.endWalk(req.user.id, req.params.id);
      return res.status(200).json({ data: walk });
    } catch (error) {
      next(error);
    }
  },

  async getWalk(req, res, next) {
    try {
      const walk = await walksService.getWalk(req.user.id, req.params.id);
      return res.status(200).json({ data: walk });
    } catch (error) {
      next(error);
    }
  },

  async listPoints(req, res, next) {
    try {
      const result = await walksService.listPoints(req.user.id, req.params.id, {
        afterId: req.query.afterId ?? req.query.after,
        limit: req.query.limit,
      });
      return res.status(200).json({ data: result });
    } catch (error) {
      next(error);
    }
  },

  async streamWalk(req, res, next) {
    try {
      const snapshot = await walksService.snapshotForStream(
        req.user.id,
        req.params.id
      );
      subscribeWalkEvents(req.params.id, req, res, snapshot);
    } catch (error) {
      next(error);
    }
  },
};
