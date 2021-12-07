var Spider = require('node-spider')

const startURL = 'https://www.tzitemzo.be/'
const prefix = 'https://www.tzitemzo.be'

var spider = new Spider({
  // How many requests can be run in parallel
  concurrent: 1,
  // How long to wait after each request
  delay: 100,
  // A stream to where internal logs are sent, optional
  //logs: process.stderr,
  // Re-visit visited URLs, false by default
  allowDuplicates: false,
  // If `true` all queued handlers will be try-catch'd, errors go to `error` callback
  catchErrors: true,
  // If `true` the spider will set the Referer header automatically on subsequent requests
  addReferrer: false,
  // If `true` adds the X-Requested-With:XMLHttpRequest header
  xhr: false,
  // If `true` adds the Connection:keep-alive header and forever option on request module
  keepAlive: false,
  // Called when there's an error, throw will be used if none is provided
  error: function (err, url) {
    console.error('err', url, err)
  },
  // Called when there are no more requests
  done: function () {},

  //- All options are passed to `request` module, for example:
  headers: { 'user-agent': 'node-spider' },
  encoding: 'utf8',
})

const html = new Set()
const images = new Set()

const fs = require('fs')
const { dirname } = require('path')
const request = require('request')
async function handleRequest(doc) {
  // Store the crawled data
  const filepath = getFilepath(doc.url)
  await fs.promises.mkdir(dirname(filepath), { recursive: true })
  await fs.promises.writeFile(filepath, doc.res.body)
  html.add(filepath)
  console.log(html.size + '\t', filepath, doc.res.body.length)

  // Download all images
  doc.$('img').each(async function (i, elem) {
    const src = doc.$(elem).attr('src')
    if (!src) return
    let url = doc.resolve(src)

    // Only download once
    const filepath = getImagePath(url)
    const ok = await exists(filepath)
    if (ok) return
    images.add(filepath)
    console.log('Images:', images.size, filepath)

    // Fix [ERR_UNESCAPED_CHARACTERS]: Request path contains unescaped characters
    url = new URL(url).toString()

    await fs.promises.mkdir(dirname(filepath), { recursive: true })
    request(url).pipe(fs.createWriteStream(filepath))
  })

  // Visit all links
  doc.$('a').each(async function (i, elem) {
    const href = doc.$(elem).attr('href')?.split('#')[0]
    if (!href) return
    let url = doc.resolve(href)

    // Stay within prefix
    if (!url.startsWith(prefix)) return

    // Only download once
    const ok = await exists(getFilepath(url))
    if (ok) return

    // Don't crawl pdfs
    if (url.endsWith('.pdf')) return

    // Fix [ERR_UNESCAPED_CHARACTERS]: Request path contains unescaped characters
    url = new URL(url).toString()

    // Go for it
    spider.queue(url, handleRequest)
  })
}

function norma(url) {
  url = url.endsWith('/') ? url.slice(0, -1) : url
  return url
}

function getFilepath(url) {
  const ext = url.split('/').pop().includes('.') ? '' : '.html'
  url = norma(url)
  return './data' + (url.slice(prefix.length) || '/index') + ext
}

function getImagePath(url) {
  return './data' + url.replace(prefix, '').replace('://', '/')
}

async function exists(url) {
  const filename = url
  if (html.has(filename) || images.has(filename)) {
    return true
  }

  const doesExist =
    (await fs.promises
      .access(filename, fs.constants.F_OK)
      .catch(() => false)) !== false

  if (doesExist) html.add(filename)

  return doesExist
}

// start crawling
spider.queue(startURL, handleRequest)
