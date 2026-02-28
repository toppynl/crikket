import type { CaptureUiState } from "../../types"

export function getViewDescription(view: CaptureUiState["view"]): string {
  if (view === "chooser") {
    return "Choose how to capture"
  }

  if (view === "review") {
    return "Review and submit"
  }

  if (view === "success") {
    return "Submission complete"
  }

  return "Capture issue details"
}
