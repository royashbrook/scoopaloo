import { expect, test } from '@playwright/test'

const pngs = [
  { src: '/apple-touch-icon.png', size: 180 },
  { src: '/icon-192.png', size: 192 },
  { src: '/icon-512.png', size: 512 },
  { src: '/icon-maskable-512.png', size: 512 },
]

test('ships decoded brand assets, exact manifest icons, and offline copies', async ({ context, page }) => {
  await page.goto('/')

  const result = await page.evaluate(async expected => {
    const manifestResponse = await fetch('/manifest.webmanifest')
    const manifest = await manifestResponse.json()
    const decoded = await Promise.all(expected.map(async ({ src }) => {
      const response = await fetch(src)
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const image = new Image()
      image.src = url
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const drawing = canvas.getContext('2d')!
      drawing.drawImage(image, 0, 0)
      const pixels = drawing.getImageData(0, 0, canvas.width, canvas.height).data
      let opaque = true
      for (let offset = 3; offset < pixels.length; offset += 4) {
        if (pixels[offset] !== 255) { opaque = false; break }
      }
      const corner = [...pixels.slice(0, 4)]
      URL.revokeObjectURL(url)
      return { src, ok: response.ok, type: blob.type, width: image.naturalWidth, height: image.naturalHeight, opaque, corner }
    }))
    const svgResponses = await Promise.all([
      '/favicon.svg',
      '/assets/brand/scoopaloo-logo.svg',
      '/assets/brand/scoopaloo-mark.svg',
      '/assets/items/vanilla-cone.svg',
      '/assets/items/sundae.svg',
      '/assets/items/soft-scoop.svg',
      '/assets/items/cone-shell.svg',
      '/assets/items/sundae-cup.svg',
    ].map(async src => {
      const response = await fetch(src)
      return { src, ok: response.ok, type: response.headers.get('content-type') }
    }))
    return { manifest, manifestOk: manifestResponse.ok, decoded, svgResponses }
  }, pngs)

  expect(result.manifestOk).toBe(true)
  expect(result.manifest.icons).toEqual([
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ])
  expect(JSON.stringify(result.manifest)).not.toContain('atlas')
  for (const [index, decoded] of result.decoded.entries()) {
    expect(decoded).toMatchObject({
      src: pngs[index].src,
      ok: true,
      type: 'image/png',
      width: pngs[index].size,
      height: pngs[index].size,
      opaque: true,
      corner: [99, 205, 180, 255],
    })
  }
  for (const asset of result.svgResponses) {
    expect(asset.ok, asset.src).toBe(true)
    expect(asset.type, asset.src).toContain('image/svg+xml')
  }

  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await context.setOffline(true)
  const offline = await page.evaluate(async assets => Promise.all(assets.map(async src => {
    const response = await fetch(src)
    if (!src.endsWith('.png')) return response.ok
    const image = new Image()
    image.src = src
    await image.decode()
    return response.ok && image.naturalWidth > 0
  })), [
    '/manifest.webmanifest',
    '/favicon.svg',
    '/assets/brand/scoopaloo-logo.svg',
    '/assets/brand/scoopaloo-mark.svg',
    '/assets/items/vanilla-cone.svg',
    '/assets/items/sundae.svg',
    '/assets/items/soft-scoop.svg',
    '/assets/items/cone-shell.svg',
    '/assets/items/sundae-cup.svg',
    ...pngs.map(icon => icon.src),
  ])
  expect(offline).not.toContain(false)
  await context.setOffline(false)

  await page.setViewportSize({ width: 1200, height: 900 })
  await page.reload()
  await page.evaluate(() => {
    const sizes = [16, 32, 48, 64, 180, 192, 512]
    document.body.innerHTML = `
      <main class="sheet">
        <h1>Scoopaloo brand QA</h1>
        <h2>mark size ladder</h2>
        <section class="ladder">${sizes.map(size => `<figure><img src="/assets/brand/scoopaloo-mark.svg" width="${size}" height="${size}"><figcaption>${size}px</figcaption></figure>`).join('')}</section>
        <h2>wordmark at 160px</h2>
        <img class="wordmark" src="/assets/brand/scoopaloo-logo.svg">
        <h2>maskable previews</h2>
        <section class="masks">
          <figure><div class="mask circle"><img src="/icon-maskable-512.png"></div><figcaption>circle</figcaption></figure>
          <figure><div class="mask squircle"><img src="/icon-maskable-512.png"></div><figcaption>squircle</figcaption></figure>
          <figure><div class="mask rounded"><img src="/icon-maskable-512.png"></div><figcaption>rounded square</figcaption></figure>
        </section>
      </main>`
    const style = document.createElement('style')
    style.textContent = `
      html, body { width: auto; height: auto; overflow: visible; }
      body { margin: 0; padding: 24px; background: #fff3e6; color: #4a3b45; font: 700 16px system-ui; }
      .sheet { width: 1152px; height: auto; }
      h1 { margin: 0 0 12px; font-size: 28px; }
      h2 { margin: 20px 0 8px; font-size: 16px; text-transform: uppercase; letter-spacing: .08em; }
      .ladder, .masks { display: flex; align-items: flex-end; gap: 14px; }
      figure { margin: 0; text-align: center; }
      figure > img, .mask { display: block; box-shadow: 0 0 0 1px #4a3b4540; }
      figcaption { margin-top: 6px; font-size: 12px; }
      .wordmark { display: block; width: 160px; height: auto; }
      .mask { width: 192px; height: 192px; overflow: hidden; }
      .mask img { display: block; width: 100%; height: 100%; }
      .circle { border-radius: 50%; }
      .squircle { border-radius: 36%; }
      .rounded { border-radius: 22%; }
    `
    document.head.append(style)
  })
  await page.locator('img').evaluateAll(images => Promise.all(images.map(image => (image as HTMLImageElement).decode())))
  await page.screenshot({ path: 'test-results/brand-contact-sheet.png', fullPage: true })
})
