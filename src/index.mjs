import { loadConfig } from './config.mjs';
import { fetchTranscriptsSince } from './fireflies.mjs';
import { generateSummary } from './openai.mjs';
import { initNotion, getLastSyncTimestamp, isDuplicate, createMeetingPage } from './notion.mjs';
import { transformToNotionPage } from './transform.mjs';

const OVERLAP_BUFFER_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_DELAY_MS = 350;

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

  // 4. Fetch transcripts from Fireflies
  console.log('\nFetching transcripts from Fireflies...');
  const transcripts = await fetchTranscriptsSince(config.firefliesApiKey, fromDate);

  if (transcripts.length === 0) {
    console.log('\nNo new transcripts found. Done.');
    return;
  }

  // 5. Process each transcript
  let synced = 0;
  let skipped = 0;
  let failed = 0;

  for (const transcript of transcripts) {
    const label = `"${transcript.title || transcript.id}"`;

    try {
      // Check for duplicate
      const duplicate = await isDuplicate(transcript.id);
      if (duplicate) {
        console.log(`  SKIP ${label} (already in Notion)`);
        skipped++;
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

      // Rate limit safety
      await sleep(RATE_LIMIT_DELAY_MS);
    } catch (err) {
      console.error(`  FAIL ${label}: ${err.message}`);
      failed++;
    }
  }

  // 6. Summary
  console.log(`\n=== Done: ${synced} synced, ${skipped} skipped, ${failed} failed ===`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
