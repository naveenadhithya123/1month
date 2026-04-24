import { Router } from "express";
import { bootstrapProfile } from "../controllers/auth.controller.js";

const router = Router();

router.post("/bootstrap", bootstrapProfile);

export default router;
