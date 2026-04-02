import type { ReasoningStep, ToolCallStep } from "../../types/stream"
import type {
  CreateNoteOutput,
  EditNoteOutput,
  ImageGenerationOutput,
  ImageSearchWidgetOutput,
  StockWidgetOutput,
  WeatherWidgetOutput,
  WriteNoteOutput,
} from "../../types/tool-outputs"


type NoteToolOutput = CreateNoteOutput | EditNoteOutput | WriteNoteOutput


export interface ToolStepWidgetAttachment {
  weatherCities?: string[]
  tradingSymbols?: string[]
  imageUrls?: string[]
  imageFilename?: string
  noteWidget?: {
    boardId: string
    noteId: string
    pending: boolean
  }
}


/**
 * Checks whether a tool step carries a weather widget payload.
 */
const hasWeatherWidgetOutput = (
  step: ToolCallStep
): step is ToolCallStep & { output: WeatherWidgetOutput } =>
  typeof step.output !== "string" && step.output.type === "display_weather_widget"


/**
 * Checks whether a tool step carries a stock widget payload.
 */
const hasStockWidgetOutput = (
  step: ToolCallStep
): step is ToolCallStep & { output: StockWidgetOutput } =>
  typeof step.output !== "string" && step.output.type === "display_stock_widget"


/**
 * Checks whether a tool step carries an image search widget payload.
 */
const hasImageSearchWidgetOutput = (
  step: ToolCallStep
): step is ToolCallStep & { output: ImageSearchWidgetOutput } =>
  typeof step.output !== "string" && step.output.type === "display_image_search_widget"


/**
 * Checks whether a tool step carries an image generation payload.
 */
const hasImageGenerationOutput = (
  step: ToolCallStep
): step is ToolCallStep & { output: ImageGenerationOutput } =>
  typeof step.output !== "string" && step.output.type === "image_generation"


/**
 * Checks whether a tool step carries a note-tool output.
 */
const hasNoteToolOutput = (
  step: ToolCallStep
): step is ToolCallStep & { output: NoteToolOutput } =>
  typeof step.output !== "string" &&
  (step.output.type === "write_note" || step.output.type === "create_note" || step.output.type === "edit_note")


/**
 * Builds widget attachments keyed by the last step index of each widget family.
 */
export const buildToolStepWidgetAttachments = (
  steps: ReasoningStep[],
  isStreaming: boolean
) => {
  const attachments = new Map<number, ToolStepWidgetAttachment>()

  let lastWeatherIndex = -1
  let lastStockIndex = -1
  let lastImageSearchIndex = -1
  let lastImageGenerationIndex = -1

  const weatherCities: string[] = []
  const tradingSymbols: string[] = []
  const imageUrls: string[] = []
  let imageFilename: string | undefined
  const lastNoteStepById = new Map<string, { index: number, boardId: string, noteType: string }>()

  steps.forEach((step, index) => {
    if (step.type !== "tool_call") return

    if (!isStreaming && hasWeatherWidgetOutput(step)) {
      lastWeatherIndex = index
      if (!weatherCities.includes(step.output.city)) {
        weatherCities.push(step.output.city)
      }
    }

    if (!isStreaming && hasStockWidgetOutput(step)) {
      lastStockIndex = index
      if (!tradingSymbols.includes(step.output.symbol)) {
        tradingSymbols.push(step.output.symbol)
      }
    }

    if (!isStreaming && hasImageSearchWidgetOutput(step)) {
      lastImageSearchIndex = index
      step.output.images.forEach((url) => {
        if (!imageUrls.includes(url)) {
          imageUrls.push(url)
        }
      })
    }

    if (!isStreaming && hasImageGenerationOutput(step)) {
      lastImageGenerationIndex = index
      imageFilename = step.output.imageUrls[0] || imageFilename
    }

    if (!hasNoteToolOutput(step)) return
    if (!step.output.noteId || !step.output.graphUid) return

    lastNoteStepById.set(step.output.noteId, {
      index,
      boardId: step.output.graphUid,
      noteType: step.output.noteType,
    })
  })

  if (lastWeatherIndex >= 0 && weatherCities.length > 0) {
    attachments.set(lastWeatherIndex, {
      ...(attachments.get(lastWeatherIndex) || {}),
      weatherCities,
    })
  }

  if (lastStockIndex >= 0 && tradingSymbols.length > 0) {
    attachments.set(lastStockIndex, {
      ...(attachments.get(lastStockIndex) || {}),
      tradingSymbols,
    })
  }

  if (lastImageSearchIndex >= 0 && imageUrls.length > 0) {
    attachments.set(lastImageSearchIndex, {
      ...(attachments.get(lastImageSearchIndex) || {}),
      imageUrls,
    })
  }

  if (lastImageGenerationIndex >= 0 && imageFilename) {
    attachments.set(lastImageGenerationIndex, {
      ...(attachments.get(lastImageGenerationIndex) || {}),
      imageFilename,
    })
  }

  lastNoteStepById.forEach(({ index, boardId, noteType }, noteId) => {
    if (noteType !== "widget") return

    attachments.set(index, {
      ...(attachments.get(index) || {}),
      noteWidget: {
        boardId,
        noteId,
        pending: isStreaming,
      },
    })
  })

  return attachments
}
