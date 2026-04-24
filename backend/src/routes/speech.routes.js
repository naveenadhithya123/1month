import { Router } from "express";
import {
  textToSpeech,
  transcribe,
} from "../controllers/speech.controller.js";
import { upload } from "../middleware/upload.middleware.js";

const router = Router();

router.post("/transcribe", upload.single("audio"), transcribe);
router.post("/speak", textToSpeech);

export default router;
