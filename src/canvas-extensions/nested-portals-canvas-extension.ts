import { Menu, setIcon, setTooltip, TFile } from "obsidian"
import { CanvasData, CanvasFileNodeData } from "src/@types/AdvancedJsonCanvas"
import { Canvas, CanvasNode, Position, Size } from "src/@types/Canvas"
import CanvasHelper from "src/utils/canvas-helper"
import { FileNameModal } from "src/utils/modal-helper"
import CanvasExtension from "./canvas-extension"

const DEFAULT_NODE_SIZE: Size = { width: 320, height: 120 }
const EXPAND_BUTTON_CLASS = 'nested-portal-expand-button'
const PARENT_NAV_CLASS = 'nested-canvas-parent-nav'

// LLM-assisted Obsidian-first nested canvas workflow built on standard Advanced Canvas portals.
export default class NestedPortalsCanvasExtension extends CanvasExtension {
  isEnabled() { return 'portalsFeatureEnabled' as const }

  init() {
    this.plugin.addCommand({
      id: 'create-nested-canvas',
      name: 'Create nested canvas',
      checkCallback: CanvasHelper.canvasCommand(
        this.plugin,
        (canvas: Canvas) => !canvas.readonly,
        (canvas: Canvas) => void this.createNestedCanvas(canvas, CanvasHelper.getCenterCoordinates(canvas, DEFAULT_NODE_SIZE))
      )
    })

    this.plugin.registerEvent(this.plugin.app.workspace.on(
      'advanced-canvas:canvas-changed',
      (canvas: Canvas) => {
        this.refreshCanvasNodes(canvas)
        this.addCardMenuButton(canvas)
        this.addParentNavigation(canvas)
      }
    ))

    this.plugin.registerEvent(this.plugin.app.workspace.on(
      'advanced-canvas:node-changed',
      (_canvas: Canvas, node: CanvasNode) => this.refreshNode(node)
    ))

    this.plugin.registerEvent(this.plugin.app.workspace.on(
      'advanced-canvas:node-added',
      (_canvas: Canvas, node: CanvasNode) => this.refreshNode(node)
    ))

    this.plugin.registerEvent(this.plugin.app.workspace.on(
      'canvas:node-menu',
      (menu: Menu, node: CanvasNode) => this.addCreateNestedCanvasMenuItem(menu, node)
    ))

    this.plugin.registerEvent(this.plugin.app.workspace.on(
      'advanced-canvas:popup-menu-created',
      (canvas: Canvas) => this.addSelectedCanvasCreateButton(canvas)
    ))
  }

  private addCreateNestedCanvasMenuItem(menu: Menu, node: CanvasNode) {
    if (node.canvas.readonly || !this.isCanvasFileNode(node)) return

    menu.addItem(item => item
      .setTitle('Create nested canvas')
      .setIcon('folder-plus')
      .onClick(() => void this.createNestedCanvasInFile(node.file!))
    )
  }

  private addSelectedCanvasCreateButton(canvas: Canvas) {
    if (canvas.readonly) return
    const node = this.getSelectedCanvasFileNode(canvas)
    if (!node) return

    CanvasHelper.addPopupMenuOption(
      canvas,
      CanvasHelper.createPopupMenuOption({
        id: 'create-nested-canvas',
        label: 'Create nested canvas',
        icon: 'folder-plus',
        callback: () => void this.createNestedCanvasInFile(node.file!)
      })
    )
  }

  private addCardMenuButton(canvas: Canvas) {
    if (canvas.readonly) return

    CanvasHelper.addCardMenuOption(
      canvas,
      CanvasHelper.createCardMenuOption(
        canvas,
        {
          id: 'create-nested-canvas',
          label: 'Create nested canvas',
          icon: 'folder-plus'
        },
        () => DEFAULT_NODE_SIZE,
        (_canvas: Canvas, pos: Position) => void this.createNestedCanvas(canvas, pos)
      )
    )
  }

  private async createNestedCanvas(canvas: Canvas, pos: Position) {
    const file = await this.createNestedCanvasFile(canvas.view.file.path)
    const node = canvas.createFileNode({
      pos,
      size: DEFAULT_NODE_SIZE,
      file
    })

    node.setData({
      ...node.getData(),
      portal: false
    } as CanvasFileNodeData)
  }

  private async createNestedCanvasInFile(parentFile: TFile) {
    const file = await this.createNestedCanvasFile(parentFile.path)
    const parentData = JSON.parse(await this.plugin.app.vault.cachedRead(parentFile)) as CanvasData
    parentData.nodes ??= []
    parentData.edges ??= []

    const pos = this.getNextNodePosition(parentData)
    parentData.nodes.push({
      id: crypto.randomUUID(),
      type: 'file',
      file: file.path,
      portal: false,
      x: pos.x,
      y: pos.y,
      width: DEFAULT_NODE_SIZE.width,
      height: DEFAULT_NODE_SIZE.height
    })

    await this.plugin.app.vault.modify(parentFile, JSON.stringify(parentData, null, 2))
  }

  private async createNestedCanvasFile(parentCanvasPath: string): Promise<TFile> {
    const targetFolderPath = parentCanvasPath.replace(/\.canvas$/i, '')
    await this.ensureFolder(targetFolderPath)

    const selectedFilePath = await new FileNameModal(
      this.plugin.app,
      targetFolderPath,
      'canvas'
    ).awaitInput()
    const targetFilePath = selectedFilePath.startsWith(`${targetFolderPath}/`)
      ? selectedFilePath
      : `${targetFolderPath}/${selectedFilePath.split('/').last()!}`

    return this.plugin.app.vault.create(targetFilePath, JSON.stringify({ nodes: [], edges: [] }, null, 2))
  }

  private refreshCanvasNodes(canvas: Canvas) {
    for (const node of canvas.nodes.values()) this.refreshNode(node)
  }

  private refreshNode(node: CanvasNode) {
    const isCanvasFile = this.isCanvasFileNode(node)
    node.nodeEl.dataset.isCanvasFileNode = isCanvasFile ? 'true' : 'false'

    node.nodeEl.querySelector(`.${EXPAND_BUTTON_CLASS}`)?.remove()
    if (!isCanvasFile) return

    const target = node.labelEl ?? node.nodeEl
    const button = target.createEl('button')
    button.classList.add(EXPAND_BUTTON_CLASS, 'clickable-icon')
    setIcon(button, 'maximize-2')
    setTooltip(button, 'Open child canvas', { placement: 'top' })

    button.addEventListener('pointerdown', event => event.stopPropagation())
    button.addEventListener('click', event => {
      event.stopPropagation()
      void this.openCanvasFile(node.file!, node.canvas)
    })

  }

  private addParentNavigation(canvas: Canvas) {
    canvas.canvasControlsEl.querySelector(`.${PARENT_NAV_CLASS}`)?.remove()

    const parentFile = this.getParentCanvasFile(canvas.view.file.path)
    if (!parentFile) return

    const controls = canvas.canvasControlsEl.createDiv({ cls: PARENT_NAV_CLASS })
    const backButton = controls.createEl('button', { cls: 'clickable-icon' })
    setIcon(backButton, 'arrow-left')
    setTooltip(backButton, 'Back to parent canvas', { placement: 'left' })
    backButton.addEventListener('click', () => void this.openCanvasFile(parentFile, canvas))

    const parentLink = controls.createEl('button', {
      cls: 'nested-canvas-parent-link',
      text: parentFile.basename
    })
    parentLink.addEventListener('click', () => void this.openCanvasFile(parentFile, canvas))
  }

  private async openCanvasFile(file: TFile, canvas: Canvas) {
    await canvas.view.leaf.openFile(file)
  }

  private getParentCanvasFile(childPath: string): TFile | null {
    const lastSlash = childPath.lastIndexOf('/')
    if (lastSlash < 0) return null

    const parentPath = `${childPath.substring(0, lastSlash)}.canvas`
    return this.plugin.app.vault.getFileByPath(parentPath)
  }

  private getSelectedCanvasFileNode(canvas: Canvas): CanvasNode | null {
    if (canvas.selection.size !== 1) return null
    const node = [...canvas.selection][0] as CanvasNode
    return this.isCanvasFileNode(node) ? node : null
  }

  private isCanvasFileNode(node: CanvasNode): boolean {
    const nodeData = node.getData() as CanvasFileNodeData
    return nodeData.type === 'file' && node.file?.extension === 'canvas'
  }

  private getNextNodePosition(data: CanvasData): Position {
    if (data.nodes.length === 0) return { x: 0, y: 0 }

    return {
      x: Math.max(...data.nodes.map(node => node.x + node.width)) + CanvasHelper.GRID_SIZE * 2,
      y: Math.min(...data.nodes.map(node => node.y))
    }
  }

  private async ensureFolder(folderPath: string) {
    const parts = folderPath.split('/').filter(part => part.length > 0)
    let currentPath = ''

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part
      const existing = this.plugin.app.vault.getAbstractFileByPath(currentPath)
      if (existing instanceof TFile) throw new Error(`Cannot create nested canvas folder because a file exists at ${currentPath}`)
      if (!existing) await this.plugin.app.vault.createFolder(currentPath)
    }
  }
}
