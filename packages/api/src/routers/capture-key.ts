import {
  assignCaptureKeyToProjectProcedure,
  createCaptureKey,
  deleteCaptureKey,
  listCaptureKeys,
  revokeCaptureKey,
  rotateCaptureKey,
  updateCaptureKeyDetails,
  updateCaptureKeyOrigins,
} from "@crikket/bug-reports/procedures/capture-keys"

/**
 * Capture Key Router
 * All logic lives in @crikket/bug-reports package modules
 */
export const captureKeyRouter = {
  list: listCaptureKeys,
  create: createCaptureKey,
  delete: deleteCaptureKey,
  update: updateCaptureKeyDetails,
  updateOrigins: updateCaptureKeyOrigins,
  revoke: revokeCaptureKey,
  rotate: rotateCaptureKey,
  assignToProject: assignCaptureKeyToProjectProcedure,
}
