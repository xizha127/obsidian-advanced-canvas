import { Menu, setIcon, setTooltip, TFile } from "obsidian"
import { CanvasFileNodeData } from "src/@types/AdvancedJsonCanvas"
import { Canvas, CanvasNode, Position, Size } from "src/@types/Canvas"
import CanvasHelper from "src/utils/canvas-helper"
import { FileNameModal } from "src/utils/modal-helper"
import CanvasExtension from "./canvas-extension"

const DEFAULT_NODE_SIZE: Size = { width: 320, height: 120 }
const EXPAND_BUTTON_CLASS = 'nested-portal-expand-button'

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
      (menu: Menu, node: CanvasNode) => this.addCreateNestedCanvasMenuItem(menu, node.canvas)
    ))

    this.plugin.registerEvent(this.plugin.app.workspace.on(
      'canvas:selection-menu',
      (menu: Menu, canvas: Canvas) => this.addCreateNestedCanvasMenuItem(menu, canvas)
    ))

    this.plugin.registerEvent(this.plugin.app.workspace.on(
      'advanced-canvas:popup-menu-created',
      (canvas: Canvas) => this.addPopupCreateButton(canvas)
    ))
  }

  private addCreateNestedCanvasMenuItem(menu: Menu, canvas: Canvas) {
    if (canvas.readonly) return

    menu.addItem(item => item
      .setTitle('Create nested canvas')
      .setIcon('folder-plus')
      .onClick(() => void this.createNestedCanvas(canvas, CanvasHelper.getCenterCoordinates(canvas, DEFAULT_NODE_SIZE)))
    )
  }

  private addPopupCreateButton(canvas: Canvas) {
    if (canvas.readonly) return

    CanvasHelper.addPopupMenuOption(
      canvas,
      CanvasHelper.createPopupMenuOption({
        id: 'create-nested-canvas',
        label: 'Create nested canvas',
        icon: 'folder-plus',
        callback: () => void this.createNestedCanvas(canvas, CanvasHelper.getCenterCoordinates(canvas, DEFAULT_NODE_SIZE))
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
    const parentCanvasPath = canvas.view.file.path
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

    const file = await this.plugin.app.vault.create(targetFilePath, JSON.stringify({ nodes: [], edges: [] }, null, 2))
    const node = canvas.createFileNode({
      pos,
      size: DEFAULT_NODE_SIZE,
      file
    })

    node.setData({
      ...node.getData(),
      portal: true
    } as CanvasFileNodeData)
    canvas.setData(canvas.getData())
  }

  private refreshCanvasNodes(canvas: Canvas) {
    for (const node of canvas.nodes.values()) this.refreshNode(node)
  }

  private refreshNode(node: CanvasNode) {
    const nodeData = node.getData() as CanvasFileNodeData
    const isCanvasFile = nodeData.type === 'file' && node.file?.extension === 'canvas'
    node.nodeEl.dataset.isCanvasFileNode = isCanvasFile ? 'true' : 'false'

    node.nodeEl.querySelector(`.${EXPAND_BUTTON_CLASS}`)?.remove()
    if (!isCanvasFile) return

    const target = node.labelEl ?? node.nodeEl
    const button = target.createEl('button')
    button.classList.add(EXPAND_BUTTON_CLASS, 'clickable-icon')
    setIcon(button, nodeData.portal ? 'minimize-2' : 'maximize-2')
    setTooltip(button, nodeData.portal ? 'Collapse child canvas' : 'Expand child canvas', { placement: 'top' })

    button.addEventListener('pointerdown', event => event.stopPropagation())
    button.addEventListener('click', event => {
      event.stopPropagation()
      this.togglePortal(node)
    })

  }

  private togglePortal(node: CanvasNode) {
    const nodeData = node.getData() as CanvasFileNodeData
    const open = !nodeData.portal

    node.setData({
      ...nodeData,
      portal: open,
      width: open ? nodeData.width : DEFAULT_NODE_SIZE.width,
      height: open ? nodeData.height : DEFAULT_NODE_SIZE.height
    })
    node.currentPortalFile = open ? nodeData.file : undefined
    node.canvas.setData(node.canvas.getData())
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
