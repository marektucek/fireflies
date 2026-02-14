const REQUIRED_VARS = [
  'FIREFLIES_API_KEY',
  'NOTION_API_KEY',
  'NOTION_DATABASE_ID',
  'OPENAI_API_KEY',
  'SUMMARY_PROMPT',
];

export function loadConfig() {
  const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    firefliesApiKey: process.env.FIREFLIES_API_KEY,
    notionApiKey: process.env.NOTION_API_KEY,
    notionDatabaseId: process.env.NOTION_DATABASE_ID,
    openaiApiKey: process.env.OPENAI_API_KEY,
    summaryPrompt: process.env.SUMMARY_PROMPT,
    lookbackHours: parseInt(process.env.LOOKBACK_HOURS || '24', 10),
    deleteAfterSync: process.env.DELETE_AFTER_SYNC === 'true',
  };
}
