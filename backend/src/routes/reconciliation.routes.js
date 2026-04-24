import { Router } from "express";
import {
  analyzeReconciliation,
  sendReconciliationEmail,
} from "../controllers/reconciliation.controller.js";
import { upload } from "../middleware/upload.middleware.js";

const router = Router();

router.post(
  "/analyze",
  upload.fields([
    { name: "invoicePdf", maxCount: 1 },
    { name: "bankPdf", maxCount: 1 },
  ]),
  analyzeReconciliation,
);
router.post("/send-email", sendReconciliationEmail);

export default router;
