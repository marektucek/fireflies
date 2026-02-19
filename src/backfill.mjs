import { loadConfig } from './config.mjs';
import { fetchAllTranscripts, deleteTranscript } from './fireflies.mjs';
import { generateSummary } from './openai.mjs';
import { initNotion, isDuplicate, createMeetingPage } from './notion.mjs';
import { transformToNotionPage } from './transform.mjs';

const RATE_LIMIT_DELAY_MS = 350;
const DELETE_DELAY_MS = 6500;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function main() {
  console.log('=== Fireflies → Notion Backfill ===');
  console.log(`Started at ${new Date().toISOString()}`);

  const config = loadConfig();
  initNotion(config.notionApiKey, config.notionDatabaseId);

  let synced = 0;
  let skipped = 0;
  let failed = 0;
  const toDelete = []; // { apiKey, id } — all confirmed-in-Notion (synced + skipped)

  for (let a = 0; a < config.firefliesApiKeys.length; a++) {
    const apiKey = config.firefliesApiKeys[a];
    const accountLabel = config.firefliesApiKeys.length > 1
      ? ` (account ${a + 1}/${config.firefliesApiKeys.length})`
      : '';

    console.log(`\nFetching all transcripts from Fireflies${accountLabel}...`);
    const transcripts = await fetchAllTranscripts(apiKey);

    for (const transcript of transcripts) {
      const label = `"${transcript.title || transcript.id}"`;
      try {
        if (await isDuplicate(transcript.id)) {
          console.log(`  SKIP ${label} (already in Notion)`);
          skipped++;
          toDelete.push({ apiKey, id: transcript.id }); // safe to delete — already in Notion
          continue;
        }
        console.log(`  Summarizing ${label}...`);
        const summary = await generateSummary(config.openaiApiKey, config.summaryPrompt, transcript.sentences);
        const { properties, children } = transformToNotionPage(transcript, summary);
        console.log(`  Creating Notion page for ${label} (${children.length} blocks)...`);
        await createMeetingPage(properties, children);
        console.log(`  OK ${label}`);
        synced++;
        toDelete.push({ apiKey, id: transcript.id });
        await sleep(RATE_LIMIT_DELAY_MS);
      } catch (err) {
        console.error(`  FAIL ${label}: ${err.message}`);
        failed++;
      }
    }
  }

  console.log(`\n=== Backfill done: ${synced} synced, ${skipped} skipped, ${failed} failed ===`);

  // Delete all confirmed-in-Notion transcripts from Fireflies (synced + skipped)
  if (toDelete.length > 0) {
    console.log(`\nDeleting ${toDelete.length} transcript(s) from Fireflies...`);
    let deleted = 0;
    let deleteFailed = 0;
    for (const { apiKey, id } of toDelete) {
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
  }

  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error('Fatal error:', err); process.exit(1); });
