import { Router } from "express";
import {
  generateImage,
  uploadImage,
} from "../controllers/image.controller.js";
import { upload } from "../middleware/upload.middleware.js";

const router = Router();

router.post("/upload", upload.single("image"), uploadImage);
router.post("/generate", generateImage);

export default router;
