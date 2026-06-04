import { normalizePath, TFile } from "obsidian"
import { AnyCanvasNodeData, CanvasData, CanvasFileNodeData, CharkoalAnyCanvasNodeData, CharkoalCanvasData, CharkoalNestedCanvasNodeData } from "src/@types/AdvancedJsonCanvas"
import { Canvas } from "src/@types/Canvas"
import CanvasExtension from "./canvas-extension"

// LLM-assisted compatibility layer: materialize Charkoal inline canvases as Advanced Canvas portals.
export default class CharkoalNestedCanvasExtension extends CanvasExtension {
  private generatedCanvasCache = new Map<string, CanvasData>()
  private pendingMaterializations = new Map<string, Promise<void>>()

  isEnabled() { return 'charkoalSupportEnabled' as const }

  init() {
    this.plugin.registerEvent(this.plugin.app.workspace.on(
      'advanced-canvas:raw-data-loaded:before',
      (data: CanvasData, changedRef: { value: boolean }, sourceFilePath: string) => {
        changedRef.value = this.convertNestedCanvasesToPortals(data, sourceFilePath) || changedRef.value
      }
    ))

    this.plugin.registerEvent(this.plugin.app.workspace.on(
      'advanced-canvas:data-loaded:after',
      (canvas: Canvas, data: CanvasData) => this.refreshAfterMaterialization(canvas, data)
    ))

    this.plugin.registerEvent(this.plugin.app.workspace.on(
      'advanced-canvas:data-requested',
      (canvas: Canvas, data: CanvasData) => {
        if (this.isInGeneratedFolder(canvas.view.file.path)) return
        this.convertPortalsToNestedCanvases(data)
      }
    ))

    this.plugin.registerEvent(this.plugin.app.vault.on('modify', (file: TFile) => {
      if (file.extension !== 'canvas' || !this.isInGeneratedFolder(file.path)) return
      void this.cacheGeneratedCanvas(file)
    }))
  }

  private convertNestedCanvasesToPortals(data: CanvasData, sourceFilePath: string): boolean {
    const nodes = data?.nodes as CharkoalAnyCanvasNodeData[] | undefined
    if (!nodes?.some(node => node.type === 'nested-canvas')) return false

    data.nodes = nodes.map(node => this.convertNodeToPortal(node, sourceFilePath)) as AnyCanvasNodeData[]
    return true
  }

  private convertNodeToPortal(node: CharkoalAnyCanvasNodeData, sourceFilePath: string): CharkoalAnyCanvasNodeData {
    if (node.type !== 'nested-canvas') return node

    const generatedFile = this.getGeneratedFilePath(sourceFilePath, node)
    const generatedData: CanvasData = {
      metadata: {
        version: '1.0-1.0',
        frontmatter: { }
      },
      nodes: node.canvas.nodes.map(childNode => this.convertNodeToPortal(childNode, generatedFile)) as AnyCanvasNodeData[],
      edges: node.canvas.edges
    }

    this.generatedCanvasCache.set(generatedFile, generatedData)
    this.scheduleMaterialization(generatedFile, generatedData, sourceFilePath)

    const portalNode: CanvasFileNodeData = {
      ...this.withoutCanvas(node),
      type: 'file',
      file: generatedFile,
      portal: true,
      charkoalNestedCanvas: {
        original: this.withoutCanvas(node),
        generatedFile
      }
    }

    return portalNode
  }

  private convertPortalsToNestedCanvases(data: CanvasData) {
    if (!data?.nodes) return

    data.nodes = data.nodes.map(node => this.convertPortalToNestedCanvas(node)) as AnyCanvasNodeData[]
  }

  private convertPortalToNestedCanvas(node: AnyCanvasNodeData): CharkoalAnyCanvasNodeData {
    const portalNode = node as CanvasFileNodeData
    if (portalNode.type !== 'file' || !portalNode.charkoalNestedCanvas) return node

    const intermediate = portalNode.charkoalNestedCanvas
    const generatedData = this.generatedCanvasCache.get(intermediate.generatedFile) ?? this.emptyCanvasData()
    const nestedCanvas: CharkoalCanvasData = {
      nodes: generatedData.nodes.map(childNode => this.convertPortalToNestedCanvas(childNode)),
      edges: generatedData.edges
    }

    return {
      ...intermediate.original,
      type: 'nested-canvas',
      id: portalNode.id,
      x: portalNode.x,
      y: portalNode.y,
      width: portalNode.width,
      height: portalNode.height,
      color: portalNode.color,
      canvas: nestedCanvas
    }
  }

  private refreshAfterMaterialization(canvas: Canvas, data: CanvasData) {
    const pending = data.nodes
      .map(node => (node as CanvasFileNodeData).charkoalNestedCanvas?.generatedFile)
      .filter((path): path is string => path !== undefined)
      .map(path => this.pendingMaterializations.get(path))
      .filter((promise): promise is Promise<void> => promise !== undefined)

    if (pending.length === 0) return

    void Promise.all(pending).then(() => {
      canvas.setData(data)
    })
  }

  private scheduleMaterialization(targetPath: string, data: CanvasData, sourceFilePath: string) {
    if (this.pendingMaterializations.has(targetPath)) return

    const promise = this.materializeCanvas(targetPath, data, sourceFilePath)
      .catch(error => console.error(`Failed to materialize Charkoal nested canvas at ${targetPath}:`, error))
      .finally(() => this.pendingMaterializations.delete(targetPath))

    this.pendingMaterializations.set(targetPath, promise)
  }

  private async materializeCanvas(targetPath: string, data: CanvasData, sourceFilePath: string) {
    const targetFile = this.plugin.app.vault.getFileByPath(targetPath)
    const sourceFile = this.plugin.app.vault.getFileByPath(sourceFilePath)

    if (targetFile && sourceFile && targetFile.stat.mtime > sourceFile.stat.mtime) {
      await this.cacheGeneratedCanvas(targetFile)
      return
    }

    await this.ensureFolder(targetPath.substring(0, targetPath.lastIndexOf('/')))
    const content = JSON.stringify(data, null, 2)

    if (targetFile) await this.plugin.app.vault.modify(targetFile, content)
    else await this.plugin.app.vault.create(targetPath, content)

    this.generatedCanvasCache.set(targetPath, data)
  }

  private async cacheGeneratedCanvas(file: TFile) {
    try {
      const data = JSON.parse(await this.plugin.app.vault.cachedRead(file)) as CanvasData
      this.generatedCanvasCache.set(file.path, data)

      for (const canvas of this.plugin.getCanvases()) {
        if (!this.canvasReferencesGeneratedFile(canvas, file.path)) continue
        canvas.requestSave()
      }
    } catch (error) {
      console.error(`Failed to cache generated Charkoal canvas at ${file.path}:`, error)
    }
  }

  private canvasReferencesGeneratedFile(canvas: Canvas, filePath: string): boolean {
    return [...canvas.nodes.values()].some(node => {
      const data = node.getData() as CanvasFileNodeData
      return data.type === 'file' && data.charkoalNestedCanvas?.generatedFile === filePath
    })
  }

  private getGeneratedFilePath(sourceFilePath: string, node: CharkoalNestedCanvasNodeData): string {
    const baseFolder = normalizePath(this.plugin.settings.getSetting('charkoalNestedCanvasFolder'))
    const sourceWithoutExtension = sourceFilePath.replace(/\.canvas$/i, '')
    const relativeSource = sourceWithoutExtension.startsWith(`${baseFolder}/`)
      ? sourceWithoutExtension.substring(baseFolder.length + 1)
      : sourceWithoutExtension
    const sourceFolder = relativeSource.split('/').map(part => this.sanitizePathPart(part)).join('/')
    const fileName = `${this.sanitizePathPart(node.title || 'Nested canvas')}--${this.sanitizePathPart(node.id)}.canvas`
    return normalizePath(`${baseFolder}/${sourceFolder}/${fileName}`)
  }

  private sanitizePathPart(value: string): string {
    return value.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim() || 'Untitled'
  }

  private isInGeneratedFolder(path: string): boolean {
    const folder = normalizePath(this.plugin.settings.getSetting('charkoalNestedCanvasFolder'))
    return path === folder || path.startsWith(`${folder}/`)
  }

  private async ensureFolder(folderPath: string) {
    if (!folderPath) return

    const parts = normalizePath(folderPath).split('/')
    let current = ''
    for (const part of parts) {
      current = current ? `${current}/${part}` : part
      if (!this.plugin.app.vault.getAbstractFileByPath(current))
        await this.plugin.app.vault.createFolder(current)
    }
  }

  private withoutCanvas(node: CharkoalNestedCanvasNodeData): Omit<CharkoalNestedCanvasNodeData, 'canvas'> {
    const result = { ...node } as Partial<CharkoalNestedCanvasNodeData>
    delete result.canvas
    return result as Omit<CharkoalNestedCanvasNodeData, 'canvas'>
  }

  private emptyCanvasData(): CanvasData {
    return {
      metadata: {
        version: '1.0-1.0',
        frontmatter: { }
      },
      nodes: [],
      edges: []
    }
  }
}
