export interface ScreenshotAnnotationPoint {
  x: number
  y: number
}

export const screenshotAnnotationColorOptions = [
  { label: "Orange", value: "#F97316" },
  { label: "Red", value: "#EF4444" },
  { label: "Blue", value: "#3B82F6" },
  { label: "Green", value: "#22C55E" },
] as const

export type ScreenshotAnnotationColor =
  (typeof screenshotAnnotationColorOptions)[number]["value"]

export interface ScreenshotStrokeAnnotation {
  kind: "stroke"
  tool: "draw" | "highlight"
  points: ScreenshotAnnotationPoint[]
  color: ScreenshotAnnotationColor
}

export interface ScreenshotRectangleAnnotation {
  kind: "rectangle"
  x: number
  y: number
  width: number
  height: number
  color: ScreenshotAnnotationColor
}

export type ScreenshotAnnotation =
  | ScreenshotStrokeAnnotation
  | ScreenshotRectangleAnnotation

export async function createAnnotatedScreenshotBlob(input: {
  annotations: ScreenshotAnnotation[]
  imageUrl: string
}): Promise<Blob | null> {
  if (input.annotations.length === 0) {
    return null
  }

  const image = await loadImage(input.imageUrl)
  const canvas = document.createElement("canvas")
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight

  const context = canvas.getContext("2d")
  if (!context) {
    throw new Error("Failed to create screenshot annotation canvas.")
  }

  drawScreenshotAnnotations({
    annotations: input.annotations,
    context,
    height: canvas.height,
    image,
    width: canvas.width,
  })

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to export annotated screenshot."))
        return
      }

      resolve(blob)
    }, "image/png")
  })
}

export function drawScreenshotAnnotations(input: {
  annotations: ScreenshotAnnotation[]
  context: CanvasRenderingContext2D
  height: number
  image: CanvasImageSource
  width: number
}): void {
  input.context.clearRect(0, 0, input.width, input.height)
  input.context.drawImage(input.image, 0, 0, input.width, input.height)

  for (const annotation of input.annotations) {
    drawAnnotation({
      annotation,
      context: input.context,
      height: input.height,
      width: input.width,
    })
  }
}

export function clampAnnotationPoint(
  point: ScreenshotAnnotationPoint
): ScreenshotAnnotationPoint {
  return {
    x: clampUnit(point.x),
    y: clampUnit(point.y),
  }
}

function drawAnnotation(input: {
  annotation: ScreenshotAnnotation
  context: CanvasRenderingContext2D
  height: number
  width: number
}): void {
  if (input.annotation.kind === "rectangle") {
    drawRectangle({
      ...input,
      annotation: input.annotation,
    })
    return
  }

  drawStroke({
    ...input,
    annotation: input.annotation,
  })
}

function drawStroke(input: {
  annotation: ScreenshotStrokeAnnotation
  context: CanvasRenderingContext2D
  height: number
  width: number
}): void {
  if (input.annotation.points.length === 0) {
    return
  }

  const { context, width, height } = input
  const strokeWidth =
    input.annotation.tool === "highlight"
      ? Math.max(14, Math.round(Math.min(width, height) * 0.025))
      : Math.max(3, Math.round(Math.min(width, height) * 0.006))

  const [firstPoint, ...remainingPoints] = input.annotation.points
  if (!firstPoint) {
    return
  }

  context.save()
  context.strokeStyle =
    input.annotation.tool === "highlight"
      ? withAlpha(input.annotation.color, 0.28)
      : input.annotation.color
  context.lineCap = "round"
  context.lineJoin = "round"
  context.lineWidth = strokeWidth
  context.beginPath()
  context.moveTo(firstPoint.x * width, firstPoint.y * height)
  for (const point of remainingPoints) {
    context.lineTo(point.x * width, point.y * height)
  }

  if (remainingPoints.length === 0) {
    context.lineTo(firstPoint.x * width + 0.01, firstPoint.y * height + 0.01)
  }

  context.stroke()
  context.restore()
}

function drawRectangle(input: {
  annotation: ScreenshotRectangleAnnotation
  context: CanvasRenderingContext2D
  height: number
  width: number
}): void {
  const { annotation, context, width, height } = input
  const x = annotation.x * width
  const y = annotation.y * height
  const rectangleWidth = annotation.width * width
  const rectangleHeight = annotation.height * height

  context.save()
  context.fillStyle = withAlpha(annotation.color, 0.08)
  context.strokeStyle = annotation.color
  context.lineWidth = Math.max(3, Math.round(Math.min(width, height) * 0.005))
  context.fillRect(x, y, rectangleWidth, rectangleHeight)
  context.strokeRect(x, y, rectangleWidth, rectangleHeight)
  context.restore()
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = "async"
    image.onload = () => {
      resolve(image)
    }
    image.onerror = () => {
      reject(new Error("Failed to load screenshot for annotation."))
    }
    image.src = source
  })
}

function withAlpha(color: ScreenshotAnnotationColor, alpha: number): string {
  const hex = color.slice(1)
  const red = Number.parseInt(hex.slice(0, 2), 16)
  const green = Number.parseInt(hex.slice(2, 4), 16)
  const blue = Number.parseInt(hex.slice(4, 6), 16)

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}
