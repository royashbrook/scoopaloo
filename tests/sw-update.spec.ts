import { expect, test } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { extname, join } from 'node:path'

// Issue 18's acceptance: prime a client on one origin, change what the server
// ships, and prove an ONLINE reload on that same origin sees the new shell.
// The old cache-first worker kept the first shell forever, and the offline test
// alone can never catch that. This spec runs its own tiny server over dist/ so
// the "deployment" can change mid-test; vite preview cannot do that.
const DIST = join(import.meta.dirname, '..', 'dist')
const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json',
}

let marker = 'BUILD-A'
let server: Server

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const path = (request.url || '/').split('?')[0]
    const file = path === '/' ? '/index.html' : path
    try {
      let body = readFileSync(join(DIST, file))
      if (file === '/index.html') {
        // the marker stands in for a new deployment's changed shell
        body = Buffer.from(body.toString().replace('</head>', `<meta name="build" content="${marker}"></head>`))
      }
      response.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' })
      response.end(body)
    } catch {
      response.writeHead(404)
      response.end()
    }
  })
  await new Promise<void>(resolve => server.listen(4180, resolve))
})

test.afterAll(async () => {
  await new Promise(resolve => server.close(resolve))
})

test('an installed client picks up a new deployment on an online reload', async ({ page }) => {
  await page.goto('http://127.0.0.1:4180/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  // reload once so the page is controlled by the worker: from here on, every
  // response the client sees flows through sw.js fetch handling
  await page.reload()
  await expect(page.locator('meta[name="build"]')).toHaveAttribute('content', 'BUILD-A')
  const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller))
  expect(controlled).toBe(true)

  marker = 'BUILD-B' // the deployment changes; same origin, same worker
  await page.reload()
  await expect(page.locator('meta[name="build"]')).toHaveAttribute('content', 'BUILD-B')
})
