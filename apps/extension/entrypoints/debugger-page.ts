import { installDebuggerPageRuntime } from "@crikket/capture-core/debugger/engine/page"
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script"

export default defineUnlistedScript(() => {
  installDebuggerPageRuntime()
})
