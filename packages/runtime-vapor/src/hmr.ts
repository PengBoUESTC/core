import {
  currentInstance,
  popWarningContext,
  pushWarningContext,
  simpleSetCurrentInstance,
} from '@vue/runtime-dom'
import { insert, normalizeBlock, remove } from './block'
import {
  type VaporComponent,
  type VaporComponentInstance,
  createComponent,
  devRender,
  mountComponent,
  unmountComponent,
} from './component'
import { handleTeleportRootComponentHmrReload } from './components/Teleport'

export function hmrRerender(instance: VaporComponentInstance): void {
  const normalized = normalizeBlock(instance.block)
  const parent = normalized[0].parentNode!
  const anchor = normalized[normalized.length - 1].nextSibling
  remove(instance.block, parent)
  if (instance.hmrRerenderEffects) {
    instance.hmrRerenderEffects.forEach(e => e())
    instance.hmrRerenderEffects.length = 0
  }
  const prev = currentInstance
  simpleSetCurrentInstance(instance)
  pushWarningContext(instance)
  devRender(instance)
  popWarningContext()
  simpleSetCurrentInstance(prev, instance)
  insert(instance.block, parent, anchor)
}

export function hmrReload(
  instance: VaporComponentInstance,
  newComp: VaporComponent,
): void {
  const normalized = normalizeBlock(instance.block)
  const parent = normalized[0].parentNode!
  const anchor = normalized[normalized.length - 1].nextSibling
  unmountComponent(instance, parent)
  const prev = currentInstance
  simpleSetCurrentInstance(instance.parent)
  const newInstance = createComponent(
    newComp,
    instance.rawProps,
    instance.rawSlots,
    instance.isSingleRoot,
  )
  simpleSetCurrentInstance(prev, instance.parent)
  mountComponent(newInstance, parent, anchor)
  handleTeleportRootComponentHmrReload(instance, newInstance)
}
