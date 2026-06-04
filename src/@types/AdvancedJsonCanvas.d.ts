export * from "assets/formats/advanced-json-canvas/spec/1.0-1.0"

import { CanvasData as OriginalCanvasData, AnyCanvasNodeData as OriginalAnyCanvasNodeData, CanvasNodeData, CanvasGroupNodeData as OriginalCanvasGroupNodeData, CanvasFileNodeData as OriginalCanvasFileNodeData, CanvasEdgeData } from "assets/formats/advanced-json-canvas/spec/1.0-1.0"
import { CanvasElementsData } from "./Canvas"

export type AnyCanvasNodeData = CanvasNodeData | CanvasGroupNodeData | CanvasFileNodeData | OriginalAnyCanvasNodeData
export interface CanvasData extends OriginalCanvasData {
  nodes: AnyCanvasNodeData[]
  edges: CanvasEdgeData[]
}

export interface CanvasGroupNodeData extends OriginalCanvasGroupNodeData {
  // Intermediate values that are not saved in the canvas
  collapsedData?: CanvasElementsData
  charkoalNestedCanvas?: CharkoalNestedCanvasIntermediateData
}

export interface CanvasFileNodeData extends OriginalCanvasFileNodeData {
  // Intermediate values that are not saved in the canvas
  isPortalLoaded?: boolean
}

export interface CharkoalCanvasData {
  nodes: CharkoalAnyCanvasNodeData[]
  edges: CanvasEdgeData[]
}

export type CharkoalAnyCanvasNodeData = AnyCanvasNodeData | CharkoalNestedCanvasNodeData

export interface CharkoalNestedCanvasNodeData extends Omit<CanvasNodeData, 'type'> {
  type: 'nested-canvas'
  canvas: CharkoalCanvasData
  title: string
}

export interface CharkoalNestedCanvasIntermediateData {
  original: Omit<CharkoalNestedCanvasNodeData, 'canvas'>
  sourceMinX: number
  sourceMinY: number
}
