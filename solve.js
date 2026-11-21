// Faster reading of the same broken-CSV policy as csv-reader 1.0.0 (the house entry of csv-reader-speed-01).
//
// The policy, unchanged from the house reader (and its d3-dsv / papaparse upstreams): a U+FEFF at the very start of
// the text is dropped; a record ends at LF or CRLF, and a line left with no characters is no record; outside quotes
// a CR not followed by LF is dropped (stray_cr); a field that opens with a quote runs to the next quote that is not
// doubled, "" inside it one quote, and each CRLF or lone CR inside it is read as LF; what follows its closing quote,
// up to the next comma or line break, is appended to it as it stands (quote_junk, when the field ends); a quote that
// never closes is read as a literal character, and the text after it is read again as unquoted (unterminated_quote);
// a quote inside an unquoted field is a literal character; fields stay strings, never trimmed or converted.
//
// columns is the first record when header is true, else null; rows holds the records after it (every record when
// header is false), each padded with "" (short_row, with fields: its count) or cut (long_row, with extra: the cut
// fields) to the first record's width; each error is {code, line, row}: line the 1-based line its record starts on
// (every LF, CRLF and lone CR inside a quoted field counted), row its record's index in rows (null for the header).

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const len = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xFEFF) pos = 1;

  let recordLine = 1;
  let recordRow = null;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads an unquoted field (or the junk after a closing quote, or the text after an unterminated quote, which is
  // read again as unquoted with the quote as its first character). Content starts at pos; the value starts as `V`.
  // Returns the value, how it ended (comma / linebreak / end) and how many characters were kept (added).
  function readUnquoted(V) {
    let value = V;
    let added = 0;
    let end = pos;
    let ended;
    let segStart = pos;
    while (true) {
      if (pos >= len) { end = len; ended = 'end'; break; }
      const c = text.charCodeAt(pos);
      if (c === 44) { end = pos; pos++; ended = 'comma'; break; }
      if (c === 10) { end = pos; pos++; line++; ended = 'linebreak'; break; }
      if (c === 13) {
        if (text.charCodeAt(pos + 1) === 10) { end = pos; pos += 2; line++; ended = 'linebreak'; break; }
        error('stray_cr');
        pos++;
        continue;
      }
      pos++;
    }
    const content = text.slice(segStart, end);
    const noCr = content.indexOf('\r') === -1 ? content : content.replaceAll('\r', '');
    value = V + noCr;
    added = noCr.length;
    return { value, ended, added };
  }

  // Reads a quoted field whose opening quote is at pos, to the next quote that is not doubled, each line break
  // inside it read as LF, and returns the value plus how it ended. An unclosed quote is read again as unquoted.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos++;
    let closed = false;
    const parts = [];
    let contentStart = pos;
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 34) {
        if (text.charCodeAt(pos + 1) === 34) {
          parts.push(text.slice(contentStart, pos).replaceAll('\r', '\n'));
          parts.push('"');
          pos += 2;
          contentStart = pos;
          continue;
        }
        parts.push(text.slice(contentStart, pos).replaceAll('\r', '\n'));
        pos++;
        closed = true;
        break;
      }
      if (c === 13) {
        parts.push(text.slice(contentStart, pos).replaceAll('\r', '\n'));
        line++;
        parts.push('\n');
        pos += text.charCodeAt(pos + 1) === 10 ? 2 : 1;
        contentStart = pos;
        continue;
      }
      if (c === 10) {
        parts.push(text.slice(contentStart, pos).replaceAll('\r', '\n'));
        line++;
        parts.push('\n');
        pos++;
        contentStart = pos;
        continue;
      }
      pos++;
    }
    if (!closed) {
      pos = open + 1;
      line = openLine;
      error('unterminated_quote');
      return readUnquoted('"');
    }
    value = parts.join('');
    if (pos >= len) return { value, ended: 'end' };
    const c = text.charCodeAt(pos);
    if (c === 44) { pos++; return { value, ended: 'comma' }; }
    if (c === 10) { pos++; line++; return { value, ended: 'linebreak' }; }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line++; return { value, ended: 'linebreak' }; }
    const junk = readUnquoted(value);
    if (junk.added > 0) error('quote_junk');
    return junk;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos++; line++; }
      else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line++; }
      else break;
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let field;
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === 'comma');

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) { columns = fields; continue; }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
