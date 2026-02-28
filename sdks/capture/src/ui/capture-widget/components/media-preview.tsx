export function MediaPreview(props: {
  media: {
    captureType: "video" | "screenshot"
    objectUrl: string
  } | null
}): React.JSX.Element | null {
  if (props.media?.captureType === "video") {
    return (
      <video
        className="block w-full"
        controls
        playsInline
        preload="metadata"
        src={props.media.objectUrl}
      >
        <track kind="captions" label="English" src="data:text/vtt,WEBVTT" />
      </video>
    )
  }

  if (props.media?.captureType === "screenshot") {
    return (
      <img
        alt="Captured screenshot"
        className="block w-full"
        src={props.media.objectUrl}
      />
    )
  }

  return null
}
