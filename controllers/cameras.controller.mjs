import { camerasService } from "../services/cameras.service.mjs";
import {
  subscribeCameraEvents,
} from "../services/cameraEvents.mjs";

export const camerasController = {
  async listMine(req, res, next) {
    try {
      const data = await camerasService.listMine(req.user.id);
      return res.status(200).json({ data });
    } catch (error) {
      next(error);
    }
  },

  async getMine(req, res, next) {
    try {
      const data = await camerasService.getMine(req.user.id, req.params.id);
      return res.status(200).json({ data });
    } catch (error) {
      next(error);
    }
  },

  async create(req, res, next) {
    try {
      const data = await camerasService.create(req.user.id, req.body);
      return res.status(201).json({ data });
    } catch (error) {
      next(error);
    }
  },

  async update(req, res, next) {
    try {
      const data = await camerasService.update(req.user.id, req.params.id, req.body);
      return res.status(200).json({ data });
    } catch (error) {
      next(error);
    }
  },

  async remove(req, res, next) {
    try {
      const data = await camerasService.remove(req.user.id, req.params.id);
      return res.status(200).json({ data });
    } catch (error) {
      next(error);
    }
  },

  async heartbeat(req, res, next) {
    try {
      const data = await camerasService.heartbeat(req.user.id, req.params.id);
      return res.status(200).json({ data });
    } catch (error) {
      next(error);
    }
  },

  async ice(req, res, next) {
    try {
      const data = await camerasService.iceFor(req.user.id, {
        cameraId: req.query.cameraId ?? req.query.camera_id,
        bookingId: req.query.bookingId ?? req.query.booking_id,
      });
      return res.status(200).json({ data });
    } catch (error) {
      next(error);
    }
  },

  async listForBooking(req, res, next) {
    try {
      const data = await camerasService.listForBooking(req.user.id, req.params.id);
      return res.status(200).json({ data });
    } catch (error) {
      next(error);
    }
  },

  async publisherSignal(req, res, next) {
    try {
      const data = await camerasService.postPublisherSignal(
        req.user.id,
        req.params.id,
        req.body
      );
      return res.status(200).json({ data });
    } catch (error) {
      next(error);
    }
  },

  async viewerSignal(req, res, next) {
    try {
      const data = await camerasService.postViewerSignal(
        req.user.id,
        req.params.id,
        req.params.cameraId,
        req.body
      );
      return res.status(200).json({ data });
    } catch (error) {
      next(error);
    }
  },

  async streamSitter(req, res, next) {
    try {
      const snapshot = await camerasService.snapshotForSitterStream(req.user.id);
      subscribeCameraEvents(
        {
          userId: req.user.id,
          sitterId: req.user.id,
        },
        req,
        res,
        snapshot
      );
    } catch (error) {
      next(error);
    }
  },

  async streamBooking(req, res, next) {
    try {
      const snapshot = await camerasService.snapshotForBookingStream(
        req.user.id,
        req.params.id
      );
      subscribeCameraEvents(
        {
          userId: req.user.id,
          bookingId: req.params.id,
          cameraIds: (snapshot.cameras ?? []).map((row) => row.id),
        },
        req,
        res,
        snapshot
      );
    } catch (error) {
      next(error);
    }
  },
};
