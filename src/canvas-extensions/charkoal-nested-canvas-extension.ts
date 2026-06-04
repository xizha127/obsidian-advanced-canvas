import { AnyCanvasNodeData, CanvasData, CanvasEdgeData, CanvasGroupNodeData, CharkoalAnyCanvasNodeData, CharkoalCanvasData, CharkoalNestedCanvasNodeData } from "src/@types/AdvancedJsonCanvas"
import { Canvas, CanvasElementsData } from "src/@types/Canvas"
import CanvasExtension from "./canvas-extension"

const ID_PREFIX = 'accharkoal||'
const ID_DELIMITER = '||'
const NESTED_PADDING = 50

// LLM-assisted compatibility layer: preserve Charkoal's inline nested-canvas format while Obsidian renders supported nodes.
export default class CharkoalNestedCanvasExtension extends CanvasExtension {
  isEnabled() { return 'charkoalSupportEnabled' as const }

  init() {
    this.plugin.registerEvent(this.plugin.app.workspace.on(
      'advanced-canvas:raw-data-loaded:before',
      (data: CanvasData, changedRef: { value: boolean }) => {
        changedRef.value = this.expandNestedCanvases(data) || changedRef.value
      }
    ))

    this.plugin.registerEvent(this.plugin.app.workspace.on(
      'advanced-canvas:data-loaded:before',
      (_canvas: Canvas, data: CanvasData) => this.expandNestedCanvases(data)
    ))

    this.plugin.registerEvent(this.plugin.app.workspace.on(
      'advanced-canvas:data-requested',
      (_canvas: Canvas, data: CanvasData) => this.collapseNestedCanvases(data)
    ))
  }

  private expandNestedCanvases(data: CanvasData): boolean {
    const nodes = data?.nodes as CharkoalAnyCanvasNodeData[] | undefined
    if (!nodes?.some(node => node.type === 'nested-canvas')) return false

    const expanded = this.expandCanvas({ nodes, edges: data.edges }, [])
    data.nodes = expanded.nodes
    data.edges = expanded.edges
    return true
  }

  private expandCanvas(source: CharkoalCanvasData, parentPath: string[]): CanvasElementsData {
    const nodes: AnyCanvasNodeData[] = []
    const edges: CanvasEdgeData[] = source.edges.map(edge => this.prefixEdge(edge, parentPath))

    for (const sourceNode of source.nodes) {
      const nodePath = [...parentPath, sourceNode.id]
      const node = this.prefixNode(sourceNode, parentPath)

      if (sourceNode.type !== 'nested-canvas') {
        nodes.push(node as AnyCanvasNodeData)
        continue
      }

      const nestedNode = sourceNode
      const sourceMinX = this.getMinimumCoordinate(nestedNode.canvas.nodes, 'x')
      const sourceMinY = this.getMinimumCoordinate(nestedNode.canvas.nodes, 'y')
      const groupNode: CanvasGroupNodeData = {
        ...node,
        type: 'group',
        label: nestedNode.title,
        charkoalNestedCanvas: {
          original: this.withoutCanvas(nestedNode),
          sourceMinX,
          sourceMinY
        }
      }

      nodes.push(groupNode)

      const nestedData = this.expandCanvas(nestedNode.canvas, nodePath)
      const offsetX = groupNode.x - sourceMinX + NESTED_PADDING
      const offsetY = groupNode.y - sourceMinY + NESTED_PADDING
      nodes.push(...nestedData.nodes.map(childNode => ({
        ...childNode,
        x: childNode.x + offsetX,
        y: childNode.y + offsetY
      })))
      edges.push(...nestedData.edges)
    }

    return { nodes, edges }
  }

  private collapseNestedCanvases(data: CanvasData) {
    if (!data?.nodes) return

    const topLevelNodes = data.nodes.filter(node => !this.isTemporaryId(node.id))
    const topLevelEdges = data.edges.filter(edge => !this.isTemporaryId(edge.id))

    data.nodes = topLevelNodes.map(node => this.restoreNode(node, data)) as AnyCanvasNodeData[]
    data.edges = topLevelEdges
  }

  private restoreNode(node: AnyCanvasNodeData, data: CanvasData): CharkoalAnyCanvasNodeData {
    const groupNode = node as CanvasGroupNodeData
    if (groupNode.type !== 'group' || !groupNode.charkoalNestedCanvas) return node

    const intermediate = groupNode.charkoalNestedCanvas
    const nestedCanvas = this.restoreCanvas(groupNode, data)
    const restored: CharkoalNestedCanvasNodeData = {
      ...intermediate.original,
      type: 'nested-canvas',
      id: groupNode.id,
      x: groupNode.x,
      y: groupNode.y,
      width: groupNode.width,
      height: groupNode.height,
      color: groupNode.color,
      title: groupNode.label ?? intermediate.original.title,
      canvas: nestedCanvas
    }

    return restored
  }

  private restoreCanvas(parent: CanvasGroupNodeData, data: CanvasData): CharkoalCanvasData {
    const parentPath = this.getPath(parent.id)
    const childNodes = data.nodes.filter(node => this.isDirectChild(node.id, parentPath))
    const childEdges = data.edges.filter(edge => this.isDirectChild(edge.id, parentPath))
    const intermediate = parent.charkoalNestedCanvas!
    const offsetX = parent.x - intermediate.sourceMinX + NESTED_PADDING
    const offsetY = parent.y - intermediate.sourceMinY + NESTED_PADDING

    return {
      nodes: childNodes.map(node => {
        const restoredNode = this.restoreNode(node, data)
        return {
          ...restoredNode,
          id: this.lastPathPart(node.id),
          x: restoredNode.x - offsetX,
          y: restoredNode.y - offsetY
        }
      }),
      edges: childEdges.map(edge => ({
        ...edge,
        id: this.lastPathPart(edge.id),
        fromNode: this.lastPathPart(edge.fromNode),
        toNode: this.lastPathPart(edge.toNode)
      }))
    }
  }

  private prefixNode(node: CharkoalAnyCanvasNodeData, parentPath: string[]): CharkoalAnyCanvasNodeData {
    if (parentPath.length === 0) return { ...node }
    return { ...node, id: this.makeTemporaryId([...parentPath, node.id]) }
  }

  private prefixEdge(edge: CanvasEdgeData, parentPath: string[]): CanvasEdgeData {
    if (parentPath.length === 0) return { ...edge }
    return {
      ...edge,
      id: this.makeTemporaryId([...parentPath, edge.id]),
      fromNode: this.makeTemporaryId([...parentPath, edge.fromNode]),
      toNode: this.makeTemporaryId([...parentPath, edge.toNode])
    }
  }

  private withoutCanvas(node: CharkoalNestedCanvasNodeData): Omit<CharkoalNestedCanvasNodeData, 'canvas'> {
    const result = { ...node } as Partial<CharkoalNestedCanvasNodeData>
    delete result.canvas
    return result as Omit<CharkoalNestedCanvasNodeData, 'canvas'>
  }

  private isDirectChild(id: string, parentPath: string[]): boolean {
    const path = this.getPath(id)
    return path.length === parentPath.length + 1 &&
      parentPath.every((part, index) => path[index] === part)
  }

  private isTemporaryId(id: string): boolean {
    return id.startsWith(ID_PREFIX)
  }

  private makeTemporaryId(path: string[]): string {
    return ID_PREFIX + path.map(encodeURIComponent).join(ID_DELIMITER)
  }

  private getPath(id: string): string[] {
    if (!this.isTemporaryId(id)) return [id]
    return id.substring(ID_PREFIX.length).split(ID_DELIMITER).map(decodeURIComponent)
  }

  private getMinimumCoordinate(nodes: CharkoalAnyCanvasNodeData[], coordinate: 'x' | 'y'): number {
    if (nodes.length === 0) return 0
    return Math.min(...nodes.map(node => node[coordinate]))
  }

  private lastPathPart(id: string): string {
    const path = this.getPath(id)
    return path[path.length - 1]!
  }
}
