// Minimal .docx writer: headings, paragraphs, label/value lines, lists, links and inline images.
// No dependencies: parts are stored uncompressed in the zip, which Word, LibreOffice and Google Docs open.

const enc = new TextEncoder();
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** Store-only zip. files: [{name, data: Uint8Array}] */
export function zip(files, type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
  const out = [], central = [];
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), n = f.data.length;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, n, true); h.setUint32(22, n, true);
    h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    out.push(new Uint8Array(h.buffer), name, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, 0, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, n, true); c.setUint32(24, n, true);
    c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + n;
  }
  const cdSize = central.reduce((a, p) => a + p.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
  return new Blob([...out, ...central, new Uint8Array(e.buffer)], { type });
}

// eslint-disable-next-line no-control-regex
const x = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const run = (t, { b = false, sz = 0, color = '' } = {}) => {
  const pr = `${b ? '<w:b/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}${sz ? `<w:sz w:val="${sz}"/>` : ''}`;
  return String(t).split('\n').map((line, i) => `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${x(line)}</w:t></w:r>`).join('');
};
const para = (inner, { space = 120, indent = 0, keep = false } = {}) =>
  `<w:p><w:pPr>${keep ? '<w:keepNext/>' : ''}<w:spacing w:after="${space}"/>${indent ? `<w:ind w:left="${indent}" w:hanging="300"/>` : ''}</w:pPr>${inner}</w:p>`;

const PAGE_W = 9638; // A4 width minus 2 cm margins, in twips
const EMU = 635; // per twip

/**
 * blocks: {h1|h2|p: text} | {kv: [label, value], link?: true} | {list: [..], numbered?: true}
 *         | {img: {data: Uint8Array, mime, w, h}, caption?}
 */
export function buildDocx(blocks) {
  const rels = [], media = [];
  let id = 0;
  const body = blocks.map((b) => {
    if (b.h1 != null) return para(run(b.h1, { b: true, sz: 32 }), { space: 200, keep: true });
    if (b.h2 != null) return para(run(b.h2, { b: true, sz: 26 }), { space: 80, keep: true });
    if (b.p != null) return para(run(b.p));
    if (b.note != null) return para(run(b.note, { color: '666666', sz: 18 }));
    if (b.pagebreak) return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    if (b.kv) {
      const [k, v] = b.kv;
      if (!b.link) return para(run(`${k}: `, { b: true }) + run(v), { space: 60 });
      const rid = `rId${++id}`;
      rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${x(v)}" TargetMode="External"/>`);
      return para(`${run(`${k}: `, { b: true })}<w:hyperlink r:id="${rid}"><w:r><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">${x(v)}</w:t></w:r></w:hyperlink>`, { space: 60 });
    }
    if (b.list) return b.list.map((t, i) => para(run(`${b.numbered ? `${i + 1}.` : '•'}\t${t}`), { space: 40, indent: 300 })).join('');
    if (b.img) {
      const n = media.length + 1, ext = /jpe?g/.test(b.img.mime) ? 'jpeg' : 'png', rid = `rId${++id}`;
      media.push({ name: `word/media/image${n}.${ext}`, data: b.img.data });
      rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${n}.${ext}"/>`);
      const maxW = PAGE_W * EMU, w = Math.min(maxW, b.img.w * 9525), h = Math.round(w * (b.img.h / b.img.w));
      const pic = `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${w}" cy="${h}"/><wp:docPr id="${n}" name="Picture ${n}"/>
<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:nvPicPr><pic:cNvPr id="${n}" name="image${n}.${ext}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
      return para(pic, { space: 40 }) + (b.caption ? para(run(b.caption, { color: '666666', sz: 18 }), { space: 200 }) : '');
    }
    return '';
  }).join('\n');

  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>
${body}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Nirmala UI" w:eastAsia="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`;
  const files = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`],
    ['word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${rels.join('')}</Relationships>`],
    ['word/styles.xml', styles],
    ['word/document.xml', doc]
  ].map(([name, s]) => ({ name, data: enc.encode(s) }));
  return zip([...files, ...media]);
}

export function dataUrlBytes(d) {
  const [head, b64] = String(d).split(',');
  const bin = atob(b64); const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return { data: a, mime: (/data:([^;]+)/.exec(head) || [])[1] || 'image/png' };
}
