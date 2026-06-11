import { CaptureSdkRuntime } from "./runtime/capture-runtime"
import type {
  CaptureContext,
  CaptureInitOptions,
  CaptureRuntimeController,
  CaptureSubmissionDraft,
  CaptureSubmitResult,
  CaptureUser,
} from "./types"

export { defaultSubmitTransport } from "./transport/default-submit-transport"
export type {
  CaptureContext,
  CaptureDebuggerSummary,
  CaptureInitOptions,
  CapturePriority,
  CaptureReportVisibility,
  CaptureRuntimeConfig,
  CaptureRuntimeController,
  CaptureSubmissionDraft,
  CaptureSubmitRequest,
  CaptureSubmitResult,
  CaptureSubmitTransport,
  CaptureType,
  CaptureUser,
} from "./types"

const runtime = new CaptureSdkRuntime()

export function init(options: CaptureInitOptions): CaptureRuntimeController {
  return runtime.init(options)
}

export function mount(target?: HTMLElement): void {
  runtime.mount(target)
}

export function unmount(): void {
  runtime.unmount()
}

export function open(): void {
  runtime.open()
}

export function close(): void {
  runtime.close()
}

export function destroy(): void {
  runtime.destroy()
}

export function startRecording(): Promise<{ startedAt: number }> {
  return runtime.startRecording()
}

export function stopRecording(): Promise<Blob | null> {
  return runtime.stopRecording()
}

export function takeScreenshot(): Promise<Blob | null> {
  return runtime.takeScreenshot()
}

export function submit(
  draft: CaptureSubmissionDraft
): Promise<CaptureSubmitResult> {
  return runtime.submit(draft)
}

export function reset(): void {
  runtime.reset()
}

export function setUser(user: CaptureUser | null): void {
  runtime.setUser(user)
}

export function setContext(context: CaptureContext | null): void {
  runtime.setContext(context)
}

export function isInitialized(): boolean {
  return runtime.isInitialized()
}

export function getConfig() {
  return runtime.getConfig()
}
