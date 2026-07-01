const GROQ_TRANSCRIBE_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const DEFAULT_MODEL = 'whisper-large-v3-turbo';

/**
 * Transcribes an audio buffer (Telegram voice notes are OGG/Opus, which Groq's
 * Whisper accepts directly) to Spanish text via Groq's OpenAI-compatible
 * transcription endpoint.
 */
// Groq validates the audio by file extension; Telegram voice notes are .oga
// (OGG/Opus), which Groq rejects, so we present the file as .ogg.
export async function transcribeAudio(buffer, filename = 'audio.ogg') {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY env var is not set');
  const model = process.env.GROQ_MODEL || DEFAULT_MODEL;

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'audio/ogg' }), filename);
  form.append('model', model);
  form.append('language', 'es');
  form.append('response_format', 'json');

  const res = await fetch(GROQ_TRANSCRIBE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` }, // fetch sets the multipart boundary
    body: form,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Groq ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return (data.text || '').trim();
}
