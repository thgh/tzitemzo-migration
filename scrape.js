var Spider = require('node-spider')

const startURL = 'https://www.tzitemzo.be/jongeren/thema2/privacy-jongeren'
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

const done = new Set()

const fs = require('fs')
const { dirname } = require('path')
async function handleRequest(doc) {
  // new page crawled
  // console.log(doc.res); // response object
  const p = file(doc.url)
  // const d = dirname(p)
  console.log(p, doc.res.body.length)
  done.add(p)
  await fs.promises.mkdir(dirname(p), { recursive: true })
  await fs.promises.writeFile(p, doc.res.body)

  // Visit all links
  doc.$('a').each(async function (i, elem) {
    const href = doc.$(elem).attr('href')?.split('#')[0]
    const url = doc.resolve(href)

    // Stay within prefix
    if (!url.startsWith(prefix)) {
      return console.log('pre', href)
    }

    // Only download once
    const ok = await exists(url)
    if (ok) {
      return // console.log('alreay', url)
    }

    // Go for it
    spider.queue(url, handleRequest)
  })
}

function norma(url) {
  url = url.endsWith('/') ? url.slice(0, -1) : url
  url = url.endsWith('.html') ? url.slice(0, -5) : url
  url = url.endsWith('.htm') ? url.slice(0, -4) : url
  return url
}

function file(url) {
  url = norma(url)
  return './data' + (url.slice(prefix.length) || '/index') + '.html'
}

async function exists(url) {
  const filename = file(url)
  if (done.has(filename)) {
    return true
  }

  const yes =
    (await fs.promises
      .access(filename, fs.constants.F_OK)
      .catch(() => false)) !== false

  if (yes) done.add(filename)

  return yes
}

// start crawling
spider.queue(startURL, handleRequest)
