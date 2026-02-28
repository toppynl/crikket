import { useEffect, useState } from "react"
import { formatDuration } from "../../../utils"

const RECORDING_TICK_MS = 250

export function useRecordingClock(input: {
  recordingDockOpen: boolean
  recordingStartedAt: number | null
}): string {
  const [recordingNow, setRecordingNow] = useState(() => Date.now())

  useEffect(() => {
    if (!(input.recordingDockOpen && input.recordingStartedAt)) {
      return
    }

    setRecordingNow(Date.now())
    const intervalId = window.setInterval(() => {
      setRecordingNow(Date.now())
    }, RECORDING_TICK_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [input.recordingDockOpen, input.recordingStartedAt])

  if (input.recordingStartedAt === null) {
    return "00:00"
  }

  return formatDuration(recordingNow - input.recordingStartedAt)
}
