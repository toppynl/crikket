import { defineUnlistedScript } from "wxt/utils/define-unlisted-script"
import { setupDebuggerContentBridge } from "@/lib/bug-report-debugger/content"

export default defineUnlistedScript(() => {
  setupDebuggerContentBridge()
})
