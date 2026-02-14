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

function buildTranscriptText(sentences) {
  if (!sentences || sentences.length === 0) return '(No transcript available)';
  return sentences
    .map((s) => `${s.speaker_name || 'Unknown'}: ${s.text}`)
    .join('\n');
}

function getAttendeeNames(attendees) {
  if (!attendees || attendees.length === 0) return [];
  return attendees.map((a) => {
    const name = a.displayName || a.email || 'Unknown';
    return name.slice(0, MAX_MULTISELECT_LENGTH);
  });
}

export function transformToNotionPage(transcript, summary) {
  const title = transcript.title || 'Untitled Meeting';
  const date = parseDate(transcript.date);
  const duration = transcript.duration ? Math.round(transcript.duration / 60) : null;
  const attendeeNames = getAttendeeNames(transcript.meeting_attendees);
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
  children.push(...textToParagraphBlocks(summary || '(No summary generated)'));

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
