const fs = require('fs')
const { readFile, writeFile } = require('fs/promises')
const path = require('path')
const cheerio = require('cheerio')

const terms = require('./terms.json')
const term_taxonomy = require('./term_taxonomy.json')
const themas = term_taxonomy
  .filter((tt) => tt.taxonomy === 'themas')
  .map((tt) => ({
    tti: tt.term_taxonomy_id,
    slug: terms.find((term) => term.term_id === tt.term_id).slug,
  }))
const leeftijdsgroepen = term_taxonomy
  .filter((tt) => tt.taxonomy === 'leeftijdsgroepen')
  .map((tt) => ({
    tti: tt.term_taxonomy_id,
    slug: terms.find((term) => term.term_id === tt.term_id).slug,
  }))
const term_relationships = []
const wp_ = 'tzo_'

;(async function main() {
  // These variables will be filled with scraped data
  let posts = []

  const scraped = getFilePaths('./data')

  // Nieuws
  // addToPosts(
  //   scraped
  //     .filter((s) => /\/nieuws.?\//.test(s))
  //     .map(toPost)
  // )

  // FAQ?
  addToPosts(
    scraped
      .filter((s) => /\/thema.?\//.test(s))
      .map(toPost)
      .map(postType('faq'))
  )

  // Vorming
  addToPosts(
    scraped
      .filter((s) => /\/vorming.?\//.test(s))
      .map(toPost)
      .map(postType('vorming'))
  )

  // Publicaties
  addToPosts(
    scraped
      .filter((s) => /\/publicaties.?\//.test(s))
      .map(toPost)
      .map(postType('publicatie'))
  )
  console.log('Total posts:', posts.length)

  // Bestel
  // const bestel = scraped.filter((s) => /\/bestel.?\//.test(s))
  // console.log('Bestel', bestel.length)

  // // over ons
  // const over = scraped.filter((s) => /\/over-ons.?\//.test(s))
  // console.log('Over ons', over.length)

  // Just in case
  posts.sort((a, b) => a.ID - b.ID)

  console.log('dumping', posts.length)
  await writeFile(
    './dump.json',
    JSON.stringify(
      {
        posts,
        term_relationships,
        // term_taxonomy,
        // terms,
      },
      null,
      2
    )
  )
  console.log('dumped', posts.length)

  const sql = []

  sql.push(`
DELETE FROM ${wp_}posts WHERE post_type LIKE 'taak' AND ID >= 1000;
INSERT INTO ${wp_}posts (
  ID,
  post_date,
  post_date_gmt,
  post_content,
  post_content_filtered,
  post_title,
  post_excerpt,
  post_name,
  to_ping,
  pinged,
  post_modified,
  post_modified_gmt,
  post_type
)
VALUES ${posts
    .map(
      (post) => `(
  ${post.ID},
  ${escape(post.post_date.replace('T', ' ').replace('Z', ''))},
  ${escape(post.post_date.replace('T', ' ').replace('Z', ''))},
  ${escape(post.post_content)},
  '',
  ${escape(post.post_title)},
  '', -- excerpt todo
  ${escape(post.post_name)},
  '',
  '',
  ${escape(post.post_date.replace('T', ' ').replace('Z', ''))},
  ${escape(post.post_date.replace('T', ' ').replace('Z', ''))},
  ${escape(post.post_type || 'post')}
  )
`
    )
    .join(', ')}`)

  // Taxonomies
  //   sql.push(`

  // DELETE FROM ${wp_}terms WHERE term_id >= 100;
  // INSERT INTO ${wp_}terms (term_id, name, slug)
  // VALUES ${terms
  //     .map(
  //       (term) => `(${term.term_id}, ${escape(term.name)}, ${escape(term.slug)})`
  //     )
  //     .join(',\n')};
  // `)

  //   sql.push(`
  // DELETE FROM ${wp_}term_taxonomy WHERE term_taxonomy_id >= 100;
  // INSERT INTO ${wp_}term_taxonomy (term_taxonomy_id, term_id, taxonomy, description, count)
  // VALUES ${term_taxonomy
  //     .map(
  //       (term) =>
  //         `(${term.term_taxonomy_id}, ${term.term_id}, ${escape(
  //           term.taxonomy
  //         )}, '', 1)`
  //     )
  //     .join(',\n')};
  // `)

  sql.push(`
  DELETE FROM ${wp_}term_relationships WHERE term_taxonomy_id >= 100;
  INSERT INTO ${wp_}term_relationships (object_id, term_taxonomy_id, term_order)
  VALUES ${term_relationships
    .map(
      (term) =>
        `(${term.object_id}, ${term.term_taxonomy_id}, ${term.term_order || 0})`
    )
    .join(',\n')};
  `)
  await writeFile('./dump.sql', sql.join(';\n\n'))
  console.log('dumped sql', sql.length)

  function addToPosts(items) {
    console.log('Add', items.length, items[0]?.post_type)
    posts.push(...items)
  }
})()

function toPost(filename) {
  const html = fs.readFileSync(filename).toString()
  const reduced = html.includes('<div class="box">')
    ? html.split('<div class="box">').pop().split('<aside id="sidebar">')[0]
    : html
  const $ = cheerio.load(reduced)

  const ID = postID()

  const post_name = filename.split('/').pop().replace('.html', '')

  const post_title = $('h2').first().text().trim()

  $('h2').remove()

  let post_content = $('.holder')
    .html()
    .replace(/\r\n\s+/g, '')
    .replace('<div class="clearfix"></div>', '')
    .trim()
  if (post_content.includes('</form>')) post_content = '<!-- empty -->'

  // Date is missing
  const post_date = new Date(
    Date.parse('2021-12-01') + (ID - 1000) * 1000 * 60 * 60
  ).toJSON()

  // Look for taxonomies in URL
  const thema = themas.find((term) => filename.includes(term.slug))
  if (thema) {
    term_relationships.push({ object_id: ID, term_taxonomy_id: thema.tti })
  } else {
    // console.log('no thema?', filename)
  }
  const groep = leeftijdsgroepen.find((term) => filename.includes(term.slug))
  if (groep) {
    term_relationships.push({ object_id: ID, term_taxonomy_id: groep.tti })
  } else {
    // console.log('no groep?', filename)
  }

  return {
    ID,
    post_date,
    // img: $('img').attr('src'),
    post_title,
    post_name,
    post_content,
  }
}

////////////////////////
/////// Helpers ////////
////////////////////////

// https://gist.github.com/kethinov/6658166#gistcomment-2936675
/** Retrieve file paths from a given folder and its subfolders. */
function getFilePaths(folderPath) {
  const entryPaths = fs
    .readdirSync(folderPath)
    .map((entry) => path.join(folderPath, entry))
  const filePaths = entryPaths.filter((e) => fs.statSync(e).isFile())
  const dirPaths = entryPaths.filter((e) => !filePaths.includes(e))
  const dirFiles = dirPaths.reduce((p, c) => p.concat(getFilePaths(c)), [])
  return [...filePaths, ...dirFiles]
}

// Usage:
// items.filter(uniq)
function uniq(v, i, a) {
  return a.findIndex((b) => b === v) === i
}

// Usage:
// items.filter(uniqBy('id'))
// items.filter(uniqBy(item => item.origin + item.path))
function uniqBy(prop) {
  return typeof prop === 'function'
    ? (v, i, a) => a.findIndex((v2) => func(v) === func(v2)) === i
    : (v, i, a) => a.findIndex((v2) => v[prop] === v2[prop]) === i
}

function escape(str) {
  return (
    "'" +
    str
      // .replace(/"/g, '\\"')
      .replace(//g, '<li>')
      .replace(/'/g, "''") +
    // .replace(/\r?\n\r?/g, '\\n')
    "'"
  )
}
function slugify(str) {
  return str
    .replace(/ - /g, ' ')
    .replace(/\s+/g, '_')
    .replace(/ë/g, 'e')
    .replace(/[^0-9a-zA-Z_-]/g, '')
    .toLowerCase()
}

// Start at 1000 so it's easy to remove all posts with ID > 1000
function postID(params) {
  const prev = global.__postID || 1000
  return (global.__postID = prev + 1)
}

function postType(type) {
  return (post) => {
    post.post_type = type
    return post
  }
}
