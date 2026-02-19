const MAX_TEXT_LENGTH = 2000;
const MAX_MULTISELECT_LENGTH = 100;

function parseDate(dateValue) {
  if (!dateValue) return null;
  // Handle Unix timestamp (seconds or milliseconds) and ISO strings
  if (typeof dateValue === 'number') {
    // Fireflies uses milliseconds, but handle seconds too
    const ts = dateValue < 1e12 ? dateValue * 1000 : dateValue;
    return new Date(ts);
  }
  return new Date(dateValue);
}

function chunkText(text, maxLen) {
  const chunks = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.slice(i, i + maxLen));
  }
  return chunks;
}

function textToParagraphBlocks(text) {
  if (!text) return [];
  const chunks = chunkText(text, MAX_TEXT_LENGTH);
  return chunks.map((chunk) => ({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content: chunk } }],
    },
  }));
}

function rt(text) {
  return [{ type: 'text', text: { content: text.slice(0, MAX_TEXT_LENGTH) } }];
}

function isSeparatorRow(line) {
  return /^\|[\s\-:|]+\|?$/.test(line.trim());
}

function parseTable(tableLines) {
  const rows = tableLines
    .filter((line) => !isSeparatorRow(line))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
    .filter((row) => row.some((cell) => cell !== ''));

  if (rows.length === 0) return null;

  const tableWidth = Math.max(...rows.map((r) => r.length));

  return {
    object: 'block',
    type: 'table',
    table: {
      table_width: tableWidth,
      has_column_header: true,
      has_row_header: false,
      children: rows.map((row) => {
        const cells = [...row];
        while (cells.length < tableWidth) cells.push('');
        return {
          type: 'table_row',
          table_row: {
            cells: cells.map((cell) => [{ type: 'text', text: { content: cell.slice(0, MAX_TEXT_LENGTH) } }]),
          },
        };
      }),
    },
  };
}

function parseMarkdownToBlocks(text) {
  if (!text) return [];

  const lines = text.split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (!trimmed) { i++; continue; }

    if (trimmed.startsWith('### ')) {
      blocks.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: rt(trimmed.slice(4)) } });
      i++; continue;
    }
    if (trimmed.startsWith('## ')) {
      blocks.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: rt(trimmed.slice(3)) } });
      i++; continue;
    }
    if (trimmed.startsWith('# ')) {
      blocks.push({ object: 'block', type: 'heading_1', heading_1: { rich_text: rt(trimmed.slice(2)) } });
      i++; continue;
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      blocks.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt(trimmed.slice(2)) } });
      i++; continue;
    }

    const numMatch = trimmed.match(/^\d+\.\s+(.+)/);
    if (numMatch) {
      blocks.push({ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: rt(numMatch[1]) } });
      i++; continue;
    }

    if (trimmed.startsWith('|')) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      const tableBlock = parseTable(tableLines);
      if (tableBlock) blocks.push(tableBlock);
      continue;
    }

    blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: rt(trimmed) } });
    i++;
  }

  return blocks;
}

function buildTranscriptText(sentences) {
  if (!sentences || sentences.length === 0) return '(No transcript available)';
  return sentences
    .map((s) => `${s.speaker_name || 'Unknown'}: ${s.text}`)
    .join('\n');
}

function getAttendeeNames(attendees) {
  if (!attendees || attendees.length === 0) return [];
  return attendees
    .map((a) => a.displayName?.trim())
    .filter(Boolean)
    .map((name) => name.slice(0, MAX_MULTISELECT_LENGTH));
}

function getAttendeeEmails(attendees) {
  if (!attendees || attendees.length === 0) return [];
  return attendees
    .map((a) => a.email?.trim())
    .filter(Boolean)
    .map((email) => email.slice(0, MAX_MULTISELECT_LENGTH));
}

export function transformToNotionPage(transcript, summary) {
  const title = transcript.title || 'Untitled Meeting';
  const date = parseDate(transcript.date);
  const duration = transcript.duration ? Math.round(transcript.duration / 60) : null;
  const attendeeNames = getAttendeeNames(transcript.meeting_attendees);
  const attendeeEmails = getAttendeeEmails(transcript.meeting_attendees);
  const transcriptText = buildTranscriptText(transcript.sentences);
  const now = new Date().toISOString();

  // Notion page properties
  const properties = {
    Name: {
      title: [{ text: { content: title } }],
    },
    'Fireflies ID': {
      rich_text: [{ text: { content: transcript.id } }],
    },
    'Synced At': {
      date: { start: now },
    },
  };

  if (date) {
    properties.Date = { date: { start: date.toISOString() } };
  }

  if (duration !== null) {
    properties.Duration = { number: duration };
  }

  if (attendeeNames.length > 0) {
    properties.Attendees = {
      multi_select: attendeeNames.map((name) => ({ name })),
    };
  }

  if (attendeeEmails.length > 0) {
    properties['Attendee Emails'] = {
      multi_select: attendeeEmails.map((email) => ({ name: email })),
    };
  }

  if (transcript.transcript_url) {
    properties['Transcript URL'] = { url: transcript.transcript_url };
  }

  // Page body (children blocks)
  const children = [];

  // AI Summary section
  children.push({
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: 'AI Summary' } }],
    },
  });
  children.push(...parseMarkdownToBlocks(summary || '(No summary generated)'));

  // Transcript section
  children.push({
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: 'Transcript' } }],
    },
  });
  children.push(...textToParagraphBlocks(transcriptText));

  return { properties, children };
}
