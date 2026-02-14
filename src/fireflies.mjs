const FIREFLIES_API_URL = 'https://api.fireflies.ai/graphql';
const PAGE_SIZE = 50;

const TRANSCRIPTS_QUERY = `
  query Transcripts($fromDate: DateTime, $limit: Int, $skip: Int) {
    transcripts(fromDate: $fromDate, limit: $limit, skip: $skip) {
      id
      title
      date
      duration
      transcript_url
      meeting_attendees {
        displayName
        email
      }
      sentences {
        speaker_name
        text
      }
    }
  }
`;

async function graphqlRequest(apiKey, query, variables = {}) {
  const res = await fetch(FIREFLIES_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fireflies API error (${res.status}): ${text}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`Fireflies GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data;
}

export async function fetchTranscriptsSince(apiKey, fromDate) {
  const allTranscripts = [];
  let skip = 0;

  // Fireflies expects Unix timestamp in milliseconds
  const fromTimestamp = fromDate.getTime();

  while (true) {
    console.log(`  Fetching transcripts (skip=${skip}, limit=${PAGE_SIZE})...`);

    const data = await graphqlRequest(apiKey, TRANSCRIPTS_QUERY, {
      fromDate: fromTimestamp,
      limit: PAGE_SIZE,
      skip,
    });

    const batch = data.transcripts || [];
    allTranscripts.push(...batch);

    if (batch.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
  }

  console.log(`  Found ${allTranscripts.length} transcript(s) since ${fromDate.toISOString()}`);
  return allTranscripts;
}
