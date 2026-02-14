import { Client } from '@notionhq/client';

let client;
let databaseId;

export function initNotion(apiKey, dbId) {
  client = new Client({ auth: apiKey });
  databaseId = dbId;
}

export async function getLastSyncTimestamp() {
  const response = await client.databases.query({
    database_id: databaseId,
    sorts: [{ property: 'Synced At', direction: 'descending' }],
    page_size: 1,
  });

  if (response.results.length === 0) return null;

  const page = response.results[0];
  const syncedAt = page.properties['Synced At']?.date?.start;
  return syncedAt ? new Date(syncedAt) : null;
}

export async function isDuplicate(firefliesId) {
  const response = await client.databases.query({
    database_id: databaseId,
    filter: {
      property: 'Fireflies ID',
      rich_text: { equals: firefliesId },
    },
    page_size: 1,
  });

  return response.results.length > 0;
}

export async function createMeetingPage(properties, children) {
  // Notion allows max 100 children per request
  const firstBatch = children.slice(0, 100);
  const remaining = children.slice(100);

  const page = await client.pages.create({
    parent: { database_id: databaseId },
    properties,
    children: firstBatch,
  });

  // Append remaining blocks in batches of 100
  for (let i = 0; i < remaining.length; i += 100) {
    const batch = remaining.slice(i, i + 100);
    await client.blocks.children.append({
      block_id: page.id,
      children: batch,
    });
  }

  return page;
}
