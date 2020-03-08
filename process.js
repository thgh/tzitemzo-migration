const fs = require('fs')
const { readFile, writeFile } = require('fs/promises')
const path = require('path')
const cheerio = require('cheerio')

;(async function main() {
  const overviewPage = await readFile('./data/doos/zoeken.html')
  let $ = cheerio.load(overviewPage)

  // List of terms
  const terms = []
  let term_id = 100

  // Relation of terms to taxonomy
  const term_taxonomy = []
  let term_taxonomy_id = 100

  // Relation of terms to posts
  const term_relationships = []
  let object_id = 100

  $('[id^=d-]').map((index, sel) => {
    const elem = $(sel)

    const taxonomy = elem.prev().prev().text().toLowerCase()
    elem.children('a').map((index, sel) => {
      const name = $(sel).text()
      term_taxonomy.push({
        term_taxonomy_id: term_taxonomy_id++,
        term_id,
        taxonomy,
      })
      terms.push({ term_id: term_id++, name, slug: slugify(name) })
    })
  })

  const files = getFilePaths('./data/doos/')
  const taskPages = await Promise.all(
    files.map((filename) =>
      fs.promises.readFile(filename).then((content) => ({ filename, content }))
    )
  )
  let posts = taskPages
    .map(({ filename, content }) => {
      content = content
        .toString()
        .replace(
          '<p><a href="javascript:history.go(-1);">&laquo; Naar vorige pagina</a></p>',
          ''
        )
      const main = content.slice(
        content.indexOf('<div id="content-area">'),
        content.indexOf('<div id="block-cck_blocks-fie')
      )

      let $ = cheerio.load(main)
      let post_title = $('h3').text().replace('Lesactiviteit:', '').trim()
      if (post_title[0] === '"' && post_title.slice(-1) === '"') {
        post_title = post_title.slice(1, -1)
      }
      const ID =
        1000 + parseInt(filename.slice(0, -5).split('taak_id=').pop(), 10)
      if (!post_title || !ID) {
        return
      }

      const post_content = $('.results')
        .html()
        .split('</h3>')
        .slice(1)
        .join('')
        .replace(/<\/?blockquote>/g, '')
        .replace('(PDF-document)<a', '(PDF-document)<br><a')
        .trim()

      const post_name = slugify(post_title)

      const post_date = new Date(
        Date.parse('2021-11-01') + (ID - 1000) * 1000 * 60 * 60
      ).toJSON()

      const aside = content.slice(
        content.indexOf('<div id="content-area">'),
        content.indexOf(`<!-- begin 'drupal footer' -->`)
      )
      $ = cheerio.load(aside)
      let taxonomy = ''
      let term_order = -1
      $('.section h4, .section a').each((i, sel) => {
        const elem = $(sel)
        if (sel.tagName === 'h4') {
          term_order = 0
          taxonomy = elem.text().replace(':', '').toLowerCase()
        } else if (sel.tagName === 'a' && taxonomy) {
          const term_name = elem.text()
          const term_id = terms.find((t) => t.name === term_name).term_id
          term_relationships.push({
            object_id: ID,
            term_taxonomy_id: term_taxonomy.find(
              (t) => t.term_id === term_id && t.taxonomy === taxonomy
            ).term_taxonomy_id,
            term_order: term_order++,
          })
        }
      })

      return {
        ID,
        post_date,
        post_title,
        post_name,
        post_content,
      }
    })
    .filter(Boolean)

  posts.sort((a, b) => a.ID - b.ID)

  posts.forEach((item) => {
    const dup = posts.find((d) => d.ID === item.ID && d !== item)
    if (dup) {
      if (JSON.stringify(dup) !== JSON.stringify(item)) {
        console.log('dup id with diff content', dup, item)
      }
    }
  })

  console.log('dumping', posts.length)
  await writeFile(
    './dump.json',
    JSON.stringify(
      {
        posts,
        term_relationships,
        term_taxonomy,
        terms,
      },
      null,
      2
    )
  )
  console.log('dumped', posts.length)

  const sql = `
DELETE FROM wp_posts WHERE post_type LIKE 'taak' AND ID >= 1000;
INSERT INTO wp_posts (
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
      (taak) => `(
  ${taak.ID},
  ${escape(taak.post_date.replace('T', ' ').replace('Z', ''))},
  ${escape(taak.post_date.replace('T', ' ').replace('Z', ''))},
  ${escape(taak.post_content)
    .replace(//g, '&lsquo;')
    .replace(//g, '&rsquo;')
    .replace(
      /= ?"? ?(http:)?(\/\/(www\.)?taalunieversum.org)?\/+onderwijs\/termen([^"]+)"?[^>]*>/g,
      '="$4">'
    )
    .replace(/href="\/taak\/(\d+)\/?[^0-9"]*"/g, 'href="?p=$1"')},
  '',
  ${escape(taak.post_title)},
  '', -- excerpt todo
  ${escape(taak.post_name)},
  '',
  '',
  ${escape(taak.post_date.replace('T', ' ').replace('Z', ''))},
  ${escape(taak.post_date.replace('T', ' ').replace('Z', ''))},
  'taak'
  )
`
    )
    .join(', ')}
;

DELETE FROM wp_term_relationships WHERE object_id >= 100;
DELETE FROM wp_term_taxonomy WHERE term_taxonomy_id >= 100;
DELETE FROM wp_terms WHERE term_id >= 100;

INSERT INTO wp_terms (term_id, name, slug)
VALUES ${terms
    .map(
      (term) => `(${term.term_id}, ${escape(term.name)}, ${escape(term.slug)})`
    )
    .join(',\n')};

INSERT INTO wp_term_taxonomy (term_taxonomy_id, term_id, taxonomy, description, count)
VALUES ${term_taxonomy
    .map(
      (term) =>
        `(${term.term_taxonomy_id}, ${term.term_id}, ${escape(
          term.taxonomy
        )}, '', 1)`
    )
    .join(',\n')};

INSERT INTO wp_term_relationships (object_id, term_taxonomy_id, term_order)
VALUES ${term_relationships
    .map(
      (term) =>
        `(${term.object_id}, ${term.term_taxonomy_id}, ${term.term_order})`
    )
    .join(',\n')};
`
  await writeFile('./dump.sql', sql)
  console.log('dumped sql', sql.length)
})()

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
