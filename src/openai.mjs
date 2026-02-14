const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';
const MAX_TRANSCRIPT_CHARS = 400_000; // ~100K tokens for gpt-4o-mini

function buildTranscriptText(sentences) {
  if (!sentences || sentences.length === 0) return '(No transcript available)';

  return sentences
    .map((s) => `${s.speaker_name || 'Unknown'}: ${s.text}`)
    .join('\n');
}

function truncateTranscript(sentences, maxChars) {
  const full = buildTranscriptText(sentences);
  if (full.length <= maxChars) return full;

  // Build a condensed version: overview + as many sentences as fit
  const lines = [];
  let charCount = 0;
  const header = `[Transcript truncated — ${sentences.length} total sentences]\n\n`;
  charCount += header.length;

  for (const s of sentences) {
    const line = `${s.speaker_name || 'Unknown'}: ${s.text}`;
    if (charCount + line.length + 1 > maxChars) break;
    lines.push(line);
    charCount += line.length + 1;
  }

  return header + lines.join('\n');
}

export async function generateSummary(apiKey, systemPrompt, sentences) {
  const transcriptText = truncateTranscript(sentences, MAX_TRANSCRIPT_CHARS);

  const res = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: transcriptText },
      ],
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error (${res.status}): ${text}`);
  }

  const json = await res.json();
  return json.choices[0].message.content;
}
