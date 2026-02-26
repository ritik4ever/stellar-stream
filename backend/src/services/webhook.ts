import axios from 'axios';

const MAX_RETRIES = 3;

export const triggerWebhook = async (event: string, data: any, attempt: number = 0): Promise<void> => {
  const url = process.env.WEBHOOK_DESTINATION_URL;

  if (!url) {
    console.log(`[Webhook] Skipping ${event}: WEBHOOK_DESTINATION_URL not set.`);
    return;
  }

  try {
    await axios.post(url, {
      event,
      payload: data,
      timestamp: new Date().toISOString(),
    });
    console.log(`[Webhook] Success: ${event} delivered.`);
  } catch (error: any) {
    if (attempt < MAX_RETRIES) {
      const delay = Math.pow(2, attempt) * 1000;
      console.log(`[Webhook] Attempt ${attempt + 1} failed. Retrying in ${delay}ms...`);
      setTimeout(() => {
        triggerWebhook(event, data, attempt + 1);
      }, delay);
    } else {
      console.error(`[Webhook] Critical: ${event} failed after ${MAX_RETRIES + 1} attempts.`);
    }
  }
};