import { warn } from '@vue/runtime-dom'
import {
  insertionAnchor,
  insertionParent,
  resetInsertionState,
  setInsertionState,
} from '../insertionState'
import {
  disableHydrationNodeLookup,
  enableHydrationNodeLookup,
  next,
} from './node'
import { isVaporAnchors, isVaporFragmentAnchor } from '@vue/shared'

export let isHydrating = false
export let currentHydrationNode: Node | null = null

export function setCurrentHydrationNode(node: Node | null): void {
  currentHydrationNode = node
}

let isOptimized = false

function performHydration<T>(
  fn: () => T,
  setup: () => void,
  cleanup: () => void,
): T {
  if (!isOptimized) {
    adoptTemplate = adoptTemplateImpl
    locateHydrationNode = locateHydrationNodeImpl

    // optimize anchor cache lookup
    ;(Comment.prototype as any).$fs = undefined
    isOptimized = true
  }
  enableHydrationNodeLookup()
  isHydrating = true
  setup()
  const res = fn()
  cleanup()
  currentHydrationNode = null
  isHydrating = false
  disableHydrationNodeLookup()
  return res
}

export function withHydration(container: ParentNode, fn: () => void): void {
  const setup = () => setInsertionState(container, 0)
  const cleanup = () => resetInsertionState()
  return performHydration(fn, setup, cleanup)
}

export function hydrateNode(node: Node, fn: () => void): void {
  const setup = () => (currentHydrationNode = node)
  const cleanup = () => {}
  return performHydration(fn, setup, cleanup)
}

export let adoptTemplate: (node: Node, template: string) => Node | null
export let locateHydrationNode: (hasFragmentAnchor?: boolean) => void

type Anchor = Comment & {
  // cached matching fragment start to avoid repeated traversal
  // on nested fragments
  $fs?: Anchor
}

export const isComment = (node: Node, data: string): node is Anchor =>
  node.nodeType === 8 && (node as Comment).data === data

/**
 * Locate the first non-fragment-comment node and locate the next node
 * while handling potential fragments.
 */
function adoptTemplateImpl(node: Node, template: string): Node | null {
  if (!(template[0] === '<' && template[1] === '!')) {
    while (node.nodeType === 8) node = node.nextSibling!
  }

  if (__DEV__) {
    const type = node.nodeType
    if (
      (type === 8 && !template.startsWith('<!')) ||
      (type === 1 &&
        !template.startsWith(`<` + (node as Element).tagName.toLowerCase())) ||
      (type === 3 &&
        template.trim() &&
        !template.startsWith((node as Text).data))
    ) {
      // TODO recover and provide more info
      warn(`adopted: `, node)
      warn(`template: ${template}`)
      warn('hydration mismatch!')
    }
  }

  currentHydrationNode = next(node)
  return node
}

const hydrationPositionMap = new WeakMap<ParentNode, Node>()

function locateHydrationNodeImpl(hasFragmentAnchor?: boolean) {
  let node: Node | null
  // prepend / firstChild
  if (insertionAnchor === 0) {
    node = insertionParent!.firstChild
  } else if (insertionAnchor) {
    // `insertionAnchor` is a Node, it is the DOM node to hydrate
    // Template:   `...<span/><!----><span/>...`// `insertionAnchor` is the placeholder
    // SSR Output: `...<span/>Content<span/>...`// `insertionAnchor` is the actual node
    node = insertionAnchor
  } else {
    node = insertionParent
      ? hydrationPositionMap.get(insertionParent) || insertionParent.lastChild
      : currentHydrationNode

    // if node is a vapor fragment anchor, find the previous one
    if (hasFragmentAnchor && node && isVaporFragmentAnchor(node)) {
      node = node.previousSibling
      if (__DEV__ && !node) {
        // this should not happen
        throw new Error(`vapor fragment anchor previous node was not found.`)
      }
    }

    if (node && isComment(node, ']')) {
      // fragment backward search
      if (node.$fs) {
        // already cached matching fragment start
        node = node.$fs
      } else {
        let cur: Node | null = node
        let curFragEnd = node
        let fragDepth = 0
        node = null
        while (cur) {
          cur = cur.previousSibling
          if (cur) {
            if (isComment(cur, '[')) {
              curFragEnd.$fs = cur
              if (!fragDepth) {
                node = cur
                break
              } else {
                fragDepth--
              }
            } else if (isComment(cur, ']')) {
              curFragEnd = cur
              fragDepth++
            }
          }
        }
      }
    }

    if (insertionParent && node) {
      const prev = node.previousSibling
      if (prev) hydrationPositionMap.set(insertionParent, prev)
    }
  }

  if (__DEV__ && !node) {
    // TODO more info
    warn('Hydration mismatch in ', insertionParent)
  }

  resetInsertionState()
  currentHydrationNode = node
}

export function locateEndAnchor(
  node: Node | null,
  open = '[',
  close = ']',
): Node | null {
  let match = 0
  while (node) {
    node = node.nextSibling
    if (node && node.nodeType === 8) {
      if ((node as Comment).data === open) match++
      if ((node as Comment).data === close) {
        if (match === 0) {
          return node
        } else {
          match--
        }
      }
    }
  }
  return null
}

export function isNonHydrationNode(node: Node): boolean {
  return (
    // empty text node
    isEmptyTextNode(node) ||
    // vdom fragment end anchor (`<!--]-->`)
    isComment(node, ']') ||
    // vapor mode specific anchors
    isVaporAnchors(node)
  )
}

export function locateVaporFragmentAnchor(
  node: Node,
  anchorLabel: string,
): Comment | undefined {
  let n = node.nextSibling
  while (n) {
    if (isComment(n, anchorLabel)) return n
    n = n.nextSibling
  }
}

export function isEmptyTextNode(node: Node): node is Text {
  return node.nodeType === 3 && !(node as Text).data.trim()
}
