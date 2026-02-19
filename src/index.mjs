import { loadConfig } from './config.mjs';
import { fetchTranscriptsSince, deleteTranscript } from './fireflies.mjs';
import { generateSummary } from './openai.mjs';
import { initNotion, getLastSyncTimestamp, isDuplicate, createMeetingPage } from './notion.mjs';
import { transformToNotionPage } from './transform.mjs';

const OVERLAP_BUFFER_MS = 60 * 60 * 1000; // 1 hour
const MAX_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000; // 3 days hard cap
const RATE_LIMIT_DELAY_MS = 350;
const DELETE_DELAY_MS = 6500; // ~9 req/min, safely under Fireflies 10 req/min limit

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== Fireflies → Notion Sync ===');
  console.log(`Started at ${new Date().toISOString()}`);

  // 1. Load & validate config
  const config = loadConfig();
  console.log('Config loaded successfully.');

  // 2. Initialize Notion client
  initNotion(config.notionApiKey, config.notionDatabaseId);

  // 3. Determine fromDate
  let fromDate;
  const lastSync = await getLastSyncTimestamp();

  if (lastSync) {
    fromDate = new Date(lastSync.getTime() - OVERLAP_BUFFER_MS);
    console.log(`Last sync: ${lastSync.toISOString()}, fetching from: ${fromDate.toISOString()}`);
  } else {
    fromDate = new Date(Date.now() - config.lookbackHours * 60 * 60 * 1000);
    console.log(`First run — fetching transcripts from last ${config.lookbackHours}h (${fromDate.toISOString()})`);
  }

  // Hard cap: never pull meetings older than 3 days
  const maxLookback = new Date(Date.now() - MAX_LOOKBACK_MS);
  if (fromDate < maxLookback) {
    console.log(`  Clamping fromDate to 3-day cap (${maxLookback.toISOString()})`);
    fromDate = maxLookback;
  }

  // 4. Fetch and process transcripts from each Fireflies account
  let synced = 0;
  let skipped = 0;
  let failed = 0;
  const syncedItems = []; // { apiKey, id } — needed to delete from correct account

  for (let a = 0; a < config.firefliesApiKeys.length; a++) {
    const apiKey = config.firefliesApiKeys[a];
    const accountLabel = config.firefliesApiKeys.length > 1 ? ` (account ${a + 1}/${config.firefliesApiKeys.length})` : '';

    console.log(`\nFetching transcripts from Fireflies${accountLabel}...`);
    const transcripts = await fetchTranscriptsSince(apiKey, fromDate);

    if (transcripts.length === 0) {
      console.log(`  No new transcripts found${accountLabel}.`);
      continue;
    }

    for (const transcript of transcripts) {
      const label = `"${transcript.title || transcript.id}"`;

      try {
        // Check for duplicate
        const duplicate = await isDuplicate(transcript.id);
        if (duplicate) {
          console.log(`  SKIP ${label} (already in Notion)`);
          skipped++;
          syncedItems.push({ apiKey, id: transcript.id });
          continue;
        }

        // Generate AI summary
        console.log(`  Summarizing ${label}...`);
        const summary = await generateSummary(
          config.openaiApiKey,
          config.summaryPrompt,
          transcript.sentences,
        );

        // Transform and create Notion page
        const { properties, children } = transformToNotionPage(transcript, summary);
        console.log(`  Creating Notion page for ${label} (${children.length} blocks)...`);
        await createMeetingPage(properties, children);

        console.log(`  OK ${label}`);
        synced++;
        syncedItems.push({ apiKey, id: transcript.id });

        // Rate limit safety
        await sleep(RATE_LIMIT_DELAY_MS);
      } catch (err) {
        console.error(`  FAIL ${label}: ${err.message}`);
        failed++;
      }
    }
  }

  // 5. Summary
  console.log(`\n=== Done: ${synced} synced, ${skipped} skipped, ${failed} failed ===`);

  // 6. Delete synced transcripts from Fireflies
  if (config.deleteAfterSync && failed === 0 && syncedItems.length > 0) {
    console.log(`\nDeleting ${syncedItems.length} transcript(s) from Fireflies...`);
    let deleted = 0;
    let deleteFailed = 0;

    for (const { apiKey, id } of syncedItems) {
      try {
        const result = await deleteTranscript(apiKey, id);
        console.log(`  DELETED "${result?.title || id}"`);
        deleted++;
        await sleep(DELETE_DELAY_MS);
      } catch (err) {
        console.error(`  DELETE FAIL ${id}: ${err.message}`);
        deleteFailed++;
      }
    }

    console.log(`\n=== Deletion: ${deleted} deleted, ${deleteFailed} failed ===`);
  } else if (config.deleteAfterSync && failed > 0) {
    console.log('\nSkipping Fireflies deletion — there were sync failures.');
  }

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
