import { Router } from "express";
import { usersController } from "../controllers/users.controller.mjs";
import { requireAuth } from "../middlewares/auth.middleware.mjs";
import { validateUpdateOwners } from "../middlewares/validateUsers.mjs";
import multer from "multer";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, callback) => {
    if (!["image/jpeg", "image/png"].includes(file.mimetype)) {
      callback(new Error("Image must be .jpg, .jpeg, or .png"));
      return;
    }
    callback(null, true);
  },
});

function uploadOwnerAvatar(req, res, next) {
  upload.single("avatar")(req, res, (error) => {
    if (!error) {
      next();
      return;
    }
    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? "Image must be 2MB or smaller"
        : error.message;
    return res.status(400).json({ message });
  });
}

const usersRouter = Router();

usersRouter.get("/", usersController.getAllUsers);

/**
 * @openapi
 * /api/users/me:
 *   get:
 *     summary: Get logged-in owner profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user
 *       401:
 *         description: Unauthorized
 */
usersRouter.get("/me", requireAuth, usersController.getMe);
/**
 * @openapi
 * /api/users/me/onboarding:
 *   patch:
 *     summary: Mark the first-visit tour seen, or clear it to replay
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               seen:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Updated user including onboarding_seen_at
 *       400:
 *         description: seen must be true or false
 *       401:
 *         description: Unauthorized
 *   put:
 *     summary: Mark the first-visit tour seen, or clear it to replay
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 */
usersRouter.patch(
  "/me/onboarding",
  requireAuth,
  usersController.setOnboardingSeen
);
usersRouter.put(
  "/me/onboarding",
  requireAuth,
  usersController.setOnboardingSeen
);
// booking Day 0 — สัตว์ของ owner ที่ login
usersRouter.get("/me/pets", requireAuth, usersController.getMyPets);
usersRouter.put(
  "/me",
  uploadOwnerAvatar,
  requireAuth,
  validateUpdateOwners,
  usersController.updateMe,
);

export default usersRouter;
