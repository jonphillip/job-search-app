import { useState } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";

const client = generateClient<Schema>();

// Temporary dev-only seed data. Remove this component before "launch".
const SEED_COMPANIES = [
  {
    name: "ElevenLabs",
    website: "https://elevenlabs.io",
    notes:
      "TTS/voice AI. Primary target. Freelance transcription app submitted 7/13.",
  },
  {
    name: "Deepgram",
    website: "https://deepgram.com",
    notes: "Speech-to-text APIs. Linguistic researcher roles historically.",
  },
  {
    name: "AssemblyAI",
    website: "https://assemblyai.com",
    notes: "Speech understanding APIs. Content/linguist roles.",
  },
  {
    name: "Speechmatics",
    website: "https://speechmatics.com",
    notes: "ASR, UK-based, strong linguistics culture.",
  },
  {
    name: "Rev",
    website: "https://rev.com",
    notes: "Transcription/captioning at scale. Freelance-to-FT pipeline.",
  },
  {
    name: "Descript",
    website: "https://descript.com",
    notes: "Audio/video editing built on transcription.",
  },
  {
    name: "Hume AI",
    website: "https://hume.ai",
    notes: "Expressive/emotional speech AI.",
  },
  {
    name: "Cartesia",
    website: "https://cartesia.ai",
    notes: "Real-time voice models.",
  },
  {
    name: "Otter.ai",
    website: "https://otter.ai",
    notes: "Meeting transcription.",
  },
  {
    name: "3Play Media",
    website: "https://3playmedia.com",
    notes: "Captioning/subtitling services. Direct IPA-adjacent work.",
  },
  {
    name: "Verbit",
    website: "https://verbit.ai",
    notes: "Transcription + captioning, hybrid AI/human.",
  },
  {
    name: "Duolingo",
    website: "https://duolingo.com",
    notes: "Language learning. Hires linguists for curriculum/phonology.",
  },
  {
    name: "Grammarly",
    website: "https://grammarly.com",
    notes: "Writing AI. Computational linguistics roles.",
  },
  {
    name: "Appen",
    website: "https://appen.com",
    notes: "Language data annotation. Entry-friendly linguist work.",
  },
  {
    name: "Welo Data",
    website: "https://welodata.ai",
    notes: "Language data services (ex-TELUS AI).",
  },
] as const;

async function listAllCompanyNames(): Promise<Set<string>> {
  const names = new Set<string>();
  let nextToken: string | null | undefined;
  do {
    const { data, nextToken: token } = await client.models.Company.list({
      nextToken,
    });
    for (const company of data) names.add(company.name);
    nextToken = token;
  } while (nextToken);
  return names;
}

export default function SeedButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const seed = async () => {
    setBusy(true);
    setResult(null);
    try {
      const existing = await listAllCompanyNames();
      let created = 0;
      let skipped = 0;
      for (const company of SEED_COMPANIES) {
        if (existing.has(company.name)) {
          skipped++;
          continue;
        }
        await client.models.Company.create({
          ...company,
          status: "RESEARCHING",
        });
        created++;
      }
      setResult(`${created} created / ${skipped} skipped`);
    } catch (err) {
      console.error(err);
      setResult("seed failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className="signout-btn"
      disabled={busy}
      onClick={seed}
      title="Dev only: bulk-create target companies"
    >
      {busy ? "SEEDING…" : (result ?? "SEED")}
    </button>
  );
}
