import { describe, expect, it } from 'vitest'
import { renderPreview, type LandingDocument } from '../landing/builder'

function documentWith(blocks: LandingDocument['blocks']): LandingDocument {
  return {
    schema_version: 1,
    meta: { brand_name: 'Connect|API Platform', show_brand: true },
    theme: {},
    blocks,
  }
}

describe('landing preview security', () => {
  it('rejects executable URL schemes in generated attributes', () => {
    const html = renderPreview(documentWith([
      {
        id: 'hero-1',
        type: 'hero',
        name: 'Hero',
        props: {
          title: 'Seguro',
          button_label: 'Executar',
          button_url: 'javascript:alert(1)',
        },
        style: {},
      },
    ]), '')

    expect(html.toLowerCase()).not.toContain('javascript:')
    const parsed = new DOMParser().parseFromString(html, 'text/html')
    expect(parsed.querySelector('.lp-actions a')).toBeNull()
  })

  it('drops executable custom HTML while preserving allowed content', () => {
    const html = renderPreview(documentWith([
      {
        id: 'html-1',
        type: 'html',
        name: 'HTML',
        props: {
          html: '<section class="custom"><h2>Conteúdo permitido</h2><img src="javascript:alert(1)" onerror="alert(2)"><script>alert(3)</script><a href="https://example.com" onclick="alert(4)">Link</a></section>',
        },
        style: {},
      },
    ]), '')

    const lower = html.toLowerCase()
    expect(lower).not.toContain('<script')
    expect(lower).not.toContain('onerror=')
    expect(lower).not.toContain('onclick=')
    expect(lower).not.toContain('javascript:')
    expect(html).toContain('Conteúdo permitido')
    expect(html).toContain('https://example.com')
  })

  it('prevents custom CSS from breaking out of the style element', () => {
    const html = renderPreview(documentWith([]), '</style><script>alert(1)</script>@import url(https://evil.invalid/x.css);body{color:red}')
    const parsed = new DOMParser().parseFromString(html, 'text/html')

    expect(html.toLowerCase()).not.toContain('<script')
    expect(parsed.scripts).toHaveLength(0)
    expect(html.toLowerCase()).not.toContain('@import')
  })
})
