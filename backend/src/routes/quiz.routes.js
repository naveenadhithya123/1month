import { Router } from "express";
import { createQuiz } from "../controllers/quiz.controller.js";

const router = Router();

router.post("/generate", createQuiz);

export default router;
