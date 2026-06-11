import { useEffect, useRef } from "react"
import { init } from "./index"
import type { CaptureInitOptions, CaptureRuntimeController } from "./types"

export type CapturePluginProps = Omit<CaptureInitOptions, "key"> & {
  publicKey: string
}

export function CapturePlugin(
  props: CapturePluginProps
): React.JSX.Element | null {
  const lifecycleVersionRef = useRef(0)
  const controllerRef = useRef<CaptureRuntimeController | null>(null)

  // `user`/`context` are read here so a freshly (re-)created controller starts
  // with the current values, but they are intentionally excluded from the
  // dependency list — live updates are handled by the sync effects below so a
  // changing user does not tear down and remount the capture runtime.
  // biome-ignore lint/correctness/useExhaustiveDependencies: user/context are synced via dedicated effects
  useEffect(() => {
    const normalizedKey = props.publicKey?.trim()
    if (!normalizedKey) {
      return
    }

    lifecycleVersionRef.current += 1
    const lifecycleVersion = lifecycleVersionRef.current
    const controller = init({
      autoMount: props.autoMount,
      context: props.context,
      host: props.host,
      key: normalizedKey,
      mountTarget: props.mountTarget,
      submitPath: props.submitPath,
      submitTransport: props.submitTransport,
      user: props.user,
      zIndex: props.zIndex,
    })
    controllerRef.current = controller

    return () => {
      queueMicrotask(() => {
        if (lifecycleVersionRef.current !== lifecycleVersion) {
          return
        }

        controllerRef.current = null
        controller.destroy()
      })
    }
  }, [
    props.autoMount,
    props.host,
    props.mountTarget,
    props.publicKey,
    props.submitPath,
    props.submitTransport,
    props.zIndex,
  ])

  // Keep the identified user/context in sync without tearing down the runtime.
  useEffect(() => {
    controllerRef.current?.setUser(props.user ?? null)
  }, [props.user])

  useEffect(() => {
    controllerRef.current?.setContext(props.context ?? null)
  }, [props.context])

  return null
}
