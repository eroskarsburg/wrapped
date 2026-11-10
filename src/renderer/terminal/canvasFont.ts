/**
 * The xterm WebGL renderer sets fonts such as " normal 15px 'Fira Code'" (with an empty style in
 * front), and Chromium rejects the leading space and keeps drawing with 10px sans-serif: live
 * programs then show tiny proportional letters spread over the cells. Trimming the value fixes it.
 */
for (const proto of [globalThis.CanvasRenderingContext2D?.prototype, globalThis.OffscreenCanvasRenderingContext2D?.prototype]) {
  const descriptor = proto && Object.getOwnPropertyDescriptor(proto, 'font')
  if (!proto || !descriptor?.set || !descriptor.get) continue
  const { get, set } = descriptor
  Object.defineProperty(proto, 'font', {
    ...descriptor,
    get,
    set(value: unknown) {
      set.call(this, typeof value === 'string' ? value.trim() : value)
    },
  })
}

export {}
