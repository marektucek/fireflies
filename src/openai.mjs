const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';
const MAX_TRANSCRIPT_CHARS = 400_000;

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

  const res = await fetch(GEMINI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `${systemPrompt}\n\nTranscript:\n${transcriptText}`,
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error (${res.status}): ${text}`);
  }

  const json = await res.json();
  const candidate = json.candidates?.[0];
  if (!candidate || !candidate.content?.parts?.length) {
    throw new Error(`Gemini API unexpected response: ${JSON.stringify(json)}`);
  }

  return candidate.content.parts.map((p) => p.text || '').join('\n').trim();
}
