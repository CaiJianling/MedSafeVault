/**
 * Dev-only helper: drive a headless Chrome tab over CDP and capture screenshots.
 * Usage: node tools/cdp_shot.mjs <url> <out.png> [stepsJson] [width] [height]
 * stepsJson: [{ "js": "…", "wait": 400 }, …]
 */
import { writeFileSync } from 'node:fs'

const [url, out, stepsRaw = '[]', widthArg = '1460', heightArg = '930'] = process.argv.slice(2)
const steps = JSON.parse(stepsRaw)
const width = Number(widthArg)
const height = Number(heightArg)
const endpoint = process.env.CDP_ENDPOINT || 'http://127.0.0.1:9222'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function findTarget() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const targets = await (await fetch(`${endpoint}/json/list`)).json()
      const page = targets.find((item) => item.type === 'page')
      if (page) return page
    } catch {
      /* chrome is still starting */
    }
    await sleep(250)
  }
  throw new Error('CDP target not found')
}

const page = await findTarget()
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let sequence = 0
const pending = new Map()

socket.addEventListener('message', (event) => {
  const data = JSON.parse(event.data)
  if (!data.id) return
  const entry = pending.get(data.id)
  if (!entry) return
  pending.delete(data.id)
  if (data.error) entry.reject(new Error(data.error.message))
  else entry.resolve(data.result)
})

function send(method, params = {}) {
  const id = ++sequence
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || 'evaluate failed')
  }
  return result.result?.value
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: false,
})
await send('Page.navigate', { url })
await sleep(1800)

for (const step of steps) {
  if (step.js) await evaluate(step.js)
  await sleep(step.wait ?? 300)
}

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(out, Buffer.from(shot.data, 'base64'))
console.log(`saved ${out}`)
socket.close()
process.exit(0)
