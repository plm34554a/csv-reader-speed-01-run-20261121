// Fast drop-in for csv-reader 1.0.0: identical answers, index-based scanner.
// Semantics (from the reference): BOM dropped, records end at LF/CRLF, empty
// lines are no records, stray CR outside quotes is dropped (stray_cr), a field
// opening with a quote runs to the next non-doubled quote ("" -> one quote,
// CRLF/lone CR inside -> LF), junk after the closing quote is appended as-is
// (quote_junk), a quote that never closes is literal and the rest is re-read
// as unquoted (unterminated_quote), quotes inside unquoted fields are literal,
// fields stay strings, rows are padded/cut to the first record's width
// (short_row/long_row), errors carry {code, line, row} with line = 1-based line
// the record starts on (counting line breaks inside quotes).

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const n = text.length;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  let recordLine = 1;
  let recordRow = null;

  function pushError(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Slow path: read an unquoted field starting at pos, with `initial` already
  // in the value. Returns {value, ended, added} where ended is 0=comma,
  // 1=line break, 2=end of text, and added counts characters kept by this
  // call (not counting `initial`). Handles stray CRs one at a time.
  function readUnquoted(initial) {
    const parts = initial ? [initial] : [];
    let added = 0;
    while (pos < n) {
      const comma = text.indexOf(',', pos);
      const lf = text.indexOf('\n', pos);
      let end, kind;
      if (comma === -1 && lf === -1) { end = n; kind = 2; }
      else if (comma === -1) { end = lf; kind = 1; }
      else if (lf === -1) { end = comma; kind = 0; }
      else if (comma < lf) { end = comma; kind = 0; }
      else { end = lf; kind = 1; }
      const seg = text.slice(pos, end);
      const cr = seg.indexOf('\r');
      if (cr === -1) {
        if (seg.length) { parts.push(seg); added += seg.length; }
        if (kind === 0) { pos = end + 1; return { value: parts.join(''), ended: 0, added }; }
        if (kind === 1) { pos = end + 1; line += 1; return { value: parts.join(''), ended: 1, added }; }
        pos = end;
        return { value: parts.join(''), ended: 2, added };
      }
      if (cr > 0) { parts.push(seg.slice(0, cr)); added += cr; }
      const crPos = pos + cr;
      if (crPos + 1 < n && text.charCodeAt(crPos + 1) === 10) {
        pos = crPos + 2;
        line += 1;
        return { value: parts.join(''), ended: 1, added };
      }
      pushError('stray_cr');
      pos = crPos + 1;
      if (pos >= n) return { value: parts.join(''), ended: 2, added };
    }
    return { value: parts.join(''), ended: 2, added };
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let ended;
    let quoted = false;

    do {
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        const open = pos;
        const openLine = line;
        let search = pos + 1;
        let close = -1;
        let doubled = false;
        while (true) {
          const q = text.indexOf('"', search);
          if (q === -1) { close = -1; break; }
          if (q + 1 < n && text.charCodeAt(q + 1) === 34) { doubled = true; search = q + 2; continue; }
          close = q;
          break;
        }
        if (close === -1) {
          pushError('unterminated_quote');
          pos = open + 1;
          line = openLine;
          const r = readUnquoted('"');
          fields.push(r.value);
          ended = r.ended;
        } else {
          const raw = text.slice(open + 1, close);
          let val;
          if (!doubled && raw.indexOf('\n') === -1 && raw.indexOf('\r') === -1) {
            val = raw;
          } else {
            const parts = [];
            let start = 0;
            let cnt = 0;
            for (let i = 0; i < raw.length; i++) {
              const ch = raw.charCodeAt(i);
              if (ch === 34) {
                if (i + 1 < raw.length && raw.charCodeAt(i + 1) === 34) {
                  parts.push(raw.slice(start, i));
                  parts.push('"');
                  i += 1;
                  start = i + 1;
                }
              } else if (ch === 13) {
                cnt += 1;
                parts.push(raw.slice(start, i));
                parts.push('\n');
                if (i + 1 < raw.length && raw.charCodeAt(i + 1) === 10) i += 1;
                start = i + 1;
              } else if (ch === 10) {
                cnt += 1;
                parts.push(raw.slice(start, i));
                parts.push('\n');
                start = i + 1;
              }
            }
            parts.push(raw.slice(start));
            val = parts.join('');
            line += cnt;
          }
          pos = close + 1;
          if (pos >= n) {
            fields.push(val);
            ended = 2;
          } else {
            const cc = text.charCodeAt(pos);
            if (cc === 44) {
              pos += 1;
              fields.push(val);
              ended = 0;
            } else if (cc === 10) {
              pos += 1;
              line += 1;
              fields.push(val);
              ended = 1;
            } else if (cc === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
              pos += 2;
              line += 1;
              fields.push(val);
              ended = 1;
            } else {
              const r = readUnquoted(val);
              if (r.added > 0) pushError('quote_junk');
              fields.push(r.value);
              ended = r.ended;
            }
          }
        }
      } else {
        quoted = false;
        const comma = text.indexOf(',', pos);
        const lf = text.indexOf('\n', pos);
        let end, kind;
        if (comma === -1 && lf === -1) { end = n; kind = 2; }
        else if (comma === -1) { end = lf; kind = 1; }
        else if (lf === -1) { end = comma; kind = 0; }
        else if (comma < lf) { end = comma; kind = 0; }
        else { end = lf; kind = 1; }
        const seg = text.slice(pos, end);
        const cr = seg.indexOf('\r');
        if (cr === -1) {
          fields.push(seg);
          if (kind === 0) { pos = end + 1; ended = 0; }
          else if (kind === 1) { pos = end + 1; line += 1; ended = 1; }
          else { pos = end; ended = 2; }
        } else if (kind === 1 && cr === seg.length - 1) {
          // CRLF: the only CR is the trailing one before the LF.
          fields.push(seg.slice(0, -1));
          pos = end + 1;
          line += 1;
          ended = 1;
        } else {
          const r = readUnquoted('');
          fields.push(r.value);
          ended = r.ended;
        }
      }
    } while (ended === 0);

    // A line that held only stray CRs is left with no characters: no record.
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.slice(width) });
      fields.length = width;
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
