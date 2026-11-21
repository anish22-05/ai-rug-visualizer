import { beforeEach, describe, expect, it } from 'vitest'
import { useSceneStore } from './sceneStore'

const spec = (name: string, x = 0) => ({ productId: 'product_01', name, sizeId: 'm', width: 160, height: 230, x, y: 0 })
const s = () => useSceneStore.getState()

describe('sceneStore', () => {
  beforeEach(() => s().clearAll())

  it('adds multiple rugs without replacing earlier ones, each with its own state', () => {
    const a = s().addRug(spec('A'))
    const b = s().addRug(spec('B', 100))
    expect(s().rugs.map((r) => r.id)).toEqual([a, b])
    expect(s().selectedId).toBe(b)
    s().updateRug(b, { rotation: 45 })
    expect(s().rugs.find((r) => r.id === a)!.rotation).toBe(0)
    expect(s().rugs.find((r) => r.id === b)!.zIndex).toBeGreaterThan(s().rugs.find((r) => r.id === a)!.zIndex)
  })

  it('deleting one rug leaves the others untouched', () => {
    const a = s().addRug(spec('A'))
    const b = s().addRug(spec('B'))
    const before = s().rugs.find((r) => r.id === a)
    s().deleteRug(b)
    expect(s().rugs).toHaveLength(1)
    expect(s().rugs[0]).toEqual(before)
    expect(s().selectedId).toBeNull()
  })

  it('records one undo step per gesture', () => {
    const a = s().addRug(spec('A'))
    s().beginGesture()
    for (let i = 1; i <= 50; i++) s().updateRug(a, { x: i })
    s().endGesture()
    expect(s().past).toHaveLength(2) // add + drag
    s().undo()
    expect(s().rugs[0].x).toBe(0)
    s().redo()
    expect(s().rugs[0].x).toBe(50)
  })

  it('undoes add, delete and reset', () => {
    const a = s().addRug(spec('A'))
    s().addRug(spec('B'))
    s().deleteRug(a)
    s().resetScene()
    expect(s().rugs).toHaveLength(0)
    s().undo() // reset
    expect(s().rugs).toHaveLength(1)
    s().undo() // delete
    expect(s().rugs).toHaveLength(2)
    s().undo() // add B
    s().undo() // add A
    expect(s().rugs).toHaveLength(0)
    s().redo()
    expect(s().rugs).toHaveLength(1)
  })

  it('a new action clears the redo stack', () => {
    s().addRug(spec('A'))
    s().undo()
    expect(s().future).toHaveLength(1)
    s().addRug(spec('B'))
    expect(s().future).toHaveLength(0)
  })

  it('reorders layers', () => {
    const a = s().addRug(spec('A'))
    const b = s().addRug(spec('B'))
    const c = s().addRug(spec('C'))
    const order = () => [...s().rugs].sort((x, y) => x.zIndex - y.zIndex).map((r) => r.id)
    expect(order()).toEqual([a, b, c])
    s().reorder(a, 'front')
    expect(order()).toEqual([b, c, a])
    s().reorder(a, 'backward')
    expect(order()).toEqual([b, a, c])
    s().reorder(c, 'back')
    expect(order()).toEqual([c, b, a])
    s().reorder(c, 'backward') // already at the back: no-op, no history entry
    expect(order()).toEqual([c, b, a])
    s().undo()
    expect(order()).toEqual([b, a, c])
  })

  it('a gesture with no change does not create history', () => {
    s().addRug(spec('A'))
    const n = s().past.length
    s().beginGesture()
    s().endGesture()
    expect(s().past).toHaveLength(n)
  })
})
