/**
 * Gita Govinda — One-Time Audio Generation (Google AI Studio)
 * ─────────────────────────────────────────────────────────────
 * Uses gemini-2.5-flash-preview-tts  (no extra deps, pure Node 18+)
 * Gemini returns raw PCM → we wrap it as WAV in-process.
 *
 * SETUP:
 *   Node 18+  (built-in fetch)  — no npm install needed
 *   mkdir audio
 *
 * RUN:
 *   GOOGLE_KEY=AIza...  node generate-audio.mjs
 *
 * OUTPUT:
 *   audio/gg_00_s.wav … audio/gg_24_e.wav   (50 files, ~1-2 MB each)
 *
 * AFTER:
 *   git init && git add audio/ && git commit -m "Gita Govinda audio"
 *   Push to a PUBLIC GitHub repo called  gita-govinda-audio
 *   CDN URL pattern:
 *   https://cdn.jsdelivr.net/gh/YOUR_USERNAME/gita-govinda-audio@main/audio/gg_01_s.wav
 */

import fs   from 'fs';
import path from 'path';

const KEY       = process.env.GOOGLE_KEY;
const MODEL = 'gemini-3.1-flash-tts-preview'; // newest, v1beta compatible
const OUT_DIR   = './audio';
const SR        = 24000;   // Gemini outputs 24 kHz, 16-bit mono PCM

// Voices — https://ai.google.dev/gemini-api/docs/speech-generation#voices
const VOICE_S = 'Leda';    // youthful, clear female    → Sanskrit chant
const VOICE_E = 'Aoede';   // warm, melodic female      → meaning narration

// Style prompts — prepended to each text; Gemini TTS actually follows these
const STYLE_S = '';  // plain IAST — style prompts cause "no audio data" on some voices
const STYLE_E = 'Read as a wise, gentle storyteller sharing something timeless and beautiful. Warm, luminous, calm — let the wonder come through naturally.';

// IAST diacritics → plain ASCII so Gemini TTS doesn't choke
// ā→aa, ī→ee, ū→oo, ṭ/ḍ/ṇ→t/d/n, ś/ṣ→sh, ṃ→m, ḥ→h
function stripIAST(t) {
  return t
    .replace(/ā/g,'aa').replace(/Ā/g,'Aa')
    .replace(/ī/g,'ee').replace(/Ī/g,'Ee')
    .replace(/ū/g,'oo').replace(/Ū/g,'Oo')
    .replace(/ṭ/g,'t') .replace(/Ṭ/g,'T')
    .replace(/ḍ/g,'d') .replace(/Ḍ/g,'D')
    .replace(/ṇ/g,'n') .replace(/Ṇ/g,'N')
    .replace(/ṅ/g,'ng').replace(/Ṅ/g,'Ng')
    .replace(/ñ/g,'ny').replace(/Ñ/g,'Ny')
    .replace(/ś/g,'sh').replace(/Ś/g,'Sh')
    .replace(/ṣ/g,'sh').replace(/Ṣ/g,'Sh')
    .replace(/ṃ/g,'m') .replace(/Ṃ/g,'M')
    .replace(/ḥ/g,'h') .replace(/Ḥ/g,'H')
    .replace(/ṝ/g,'ri').replace(/ṛ/g,'ri')
    .replace(/ḷ/g,'l');
}
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

// ── PCM → WAV (no deps, pure Buffer arithmetic) ──────────────
function pcmToWav(pcm, sampleRate = SR, channels = 1, bits = 16) {
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + pcm.length, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16,  16);
  wav.writeUInt16LE(1,   20);   // PCM
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * channels * bits / 8, 28);
  wav.writeUInt16LE(channels * bits / 8, 32);
  wav.writeUInt16LE(bits, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  return wav;
}

// ── Single TTS call with retry ────────────────────────────────
async function tts(text, voice, filename, stylePrompt, retries = 3) {
  const outPath = path.join(OUT_DIR, filename);
  if (fs.existsSync(outPath)) {
    console.log(`⏭  skip   ${filename}`);
    return 'skip';
  }

  const prompt = stylePrompt ? `${stylePrompt}\n\n${text}` : text;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } }
            }
          }
        })
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = `HTTP ${res.status} — ${err?.error?.message || JSON.stringify(err)}`;
      if (attempt < retries) {
        console.log(`   ↻  attempt ${attempt} failed (${msg}), retrying in 3s...`);
        await sleep(3000); continue;
      }
      throw new Error(msg);
    }

    const json = await res.json();
    const part = json?.candidates?.[0]?.content?.parts?.[0];

    if (!part?.inlineData?.data) {
      // Log full response so we can see why — safety block, empty candidate, etc.
      const reason = json?.candidates?.[0]?.finishReason || 'unknown';
      const safety = json?.candidates?.[0]?.safetyRatings
        ? JSON.stringify(json.candidates[0].safetyRatings) : 'none';
      const msg = `No audio data (finishReason: ${reason}, safety: ${safety})`;
      if (attempt < retries) {
        console.log(`   ↻  attempt ${attempt} — ${msg}, retrying in 4s...`);
        await sleep(4000); continue;
      }
      throw new Error(msg);
    }

    const pcm = Buffer.from(part.inlineData.data, 'base64');
    const wav = pcmToWav(pcm);
    fs.writeFileSync(outPath, wav);
    console.log(`✓  done    ${filename}   ${(wav.length/1024).toFixed(0)} KB`);
    return 'done';
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── All text data ─────────────────────────────────────────────
const ITEMS = [
  { id:'00',
    s:`मेघैर्मेदुरमम्बरं वनभुवः श्यामास्तमालद्रुमैः
नक्तं भीरुरयं त्वमेव तदिमं राधे गृहं प्रापय
इत्थं नन्दनिदेशतश्चलितयोः प्रत्यध्वकुञ्जद्रुमं
राधामाधवयोर्जयन्ति यमुनाकूले रहःकेलयः`,
    e:`The sky grows heavy with clouds; the woodlands darken with tamala trees. He is afraid of the night — O Radha, take him home, so Nanda instructs. As the two set off together, straying tree to tree through the bowers, the secret love-play of Radha and Madhava on the banks of the Yamuna triumphs for ever.` },

  { id:'01', s:`प्रलयपयोधिजले धृतवानसि वेदम् । केशव धृतमीनशरीर जय जगदीश हरे ॥`,
    e:`In the waters of cosmic dissolution you upheld the Vedas, effortlessly playing the part of a boat. O Keshava who took the body of a fish — victory to you, O Lord of the Universe, Hari! Opening verse of the Dashavatara hymn praising Vishnu's ten incarnations.` },

  { id:'02', s:`श्रितकमलाकुचमण्डल धृतकुण्डल । जय जय देव हरे ॥`,
    e:`O you who rest upon Lakshmi's breast, wearing glittering earrings and a forest garland — victory, victory to you, O divine Hari! This second hymn closes the invocatory praise before the narrative of Radha and Krishna's love begins.` },

  { id:'03', s:`ललितलवङ्गलतापरिशीलनकोमलमलयसमीरे विहरति हरिरिह सरसवसन्ते । नृत्यति युवतिजनेन समं सखि विरहिजनस्य दुरन्ते ॥`,
    e:`A soft Malaya breeze caresses tender clove vines; the forest bowers hum with bees and ring with the cuckoo's cry. Here Hari plays in the lush springtime, friend — dancing with the young women, while for the one parted from him this spring is anguish without end.` },

  { id:'04', s:`चन्दनचर्चितनीलकलेवरपीतवसनवनमाली । हरिरिह मुग्धवधूनिकरे विलासिनि विलसति केलिपरे ॥`,
    e:`His dark body anointed with sandal paste, clothed in yellow silk, garlanded with wildflowers; cheeks lit by swaying jewelled earrings, his smile radiant — here Hari sports among the enchanted cowherd women, lost in love-play, O lovely one.` },

  { id:'05', s:`सञ्चरदधरसुधामधुरध्वनिमुखरितमोहनवंशम् रासे हरिमिह विहितविलासं स्मरति मनो मम कृतपरिहासम् ॥`,
    e:`His enchanting flute murmurs sweet as nectar at his moving lips; restless glances, swaying crest, trembling earrings at his cheeks. My heart remembers Hari at his playful sport in the rasa dance — the Hari who once teased me there.` },

  { id:'06', s:`सखि हे केशिमथनमुदारम् रमय मया सह मदनमनोरथभावितया सविकारम् ॥`,
    e:`O friend — bring the generous slayer of Keshi to make love with me, trembling and stirred as I am with longing's desire. Radha confides her deepest yearning to her trusted friend.` },

  { id:'07', s:`मामियं चलिता विलोक्य वृतं वधूनिचयेन । हरि हरि हतादरतया गता सा कुपितेव ॥`,
    e:`Seeing me encircled by the throng of cowherd women, she — alas, alas! — feeling slighted, turned and went away as though in anger. Krishna laments Radha's wounded departure.` },

  { id:'08', s:`निन्दति चन्दनमिन्दुकिरणमनुविन्दति खेदम् सा विरहे तव दीना माधव मनसिजविशिखभयादिव भावनया त्वयि लीना ॥`,
    e:`She reviles the sandal paste, finds only torment in the moon's rays; the Malaya breeze feels like venom from a serpent's den. In separation from you she is wretched, Madhava — as if fearing love's arrows, she has dissolved into you in every thought.` },

  { id:'09', s:`स्तनविनिहितमपि हारमुदारं सा मनुते कृशतनुरिव भारम् ॥`,
    e:`Frail-bodied, she feels even a delicate necklace laid upon her breast as an unbearable weight; sandal paste seems poison, cool breezes seem flame. So worn has she grown in separation from you, Keshava.` },

  { id:'10', s:`वहति मलयसमीरे मदनमुपनिधाय स्फुटति कुसुमनिकरे विरहिहृदयदलनाय ॥`,
    e:`As the Malaya breeze blows it carries Madana's fire with it; the blossoms burst open as if to split the heart of the separated lover. She lies sleepless, only your name on her lips — come to her, O Vanamali.` },

  { id:'11', s:`धीरसमीरे यमुनातीरे वसति वने वनमाली । रतिसुखसारे गतमभिसारे ॥`,
    e:`By the gentle Yamuna in the steady breeze, the forest-garlanded one waits in the grove. Go to the tryst, where the very essence of love's joy awaits — the friend urges Radha onward toward Krishna.` },

  { id:'12', s:`पश्यति दिशि दिशि रहसि भवन्तम् नाथ हरे सीदति राधा वासगृहे ॥`,
    e:`She looks for you in every direction, secretly, longingly; her whole being absorbed in the waves of your virtues. O Master Hari, Radha languishes in the bower — every sight and every word has become only you.` },

  { id:'13', s:`कथितसमयेऽपि हरिरहह न ययौ वनम् यामि हे कमिह शरणं सखीजनवचनवञ्चिता ॥`,
    e:`Even at the appointed hour — alas, alas! — Hari did not come to the grove. Deceived by my friends' assurances, where now shall I go for refuge? Radha despairs when Krishna fails to appear at the tryst.` },

  { id:'14', s:`स्मरसमरोचितविरचितवेशा हरिमेकरसं चिरमभिलषितविलासम् ॥`,
    e:`Dressed for the battle of love, some fortunate woman is enjoying with Hari the long-desired love-play. So Radha torments herself, imagining Krishna with a rival as she waits in vain and alone.` },

  { id:'15', s:`समुदितमदने रमणीवदने चुम्बनवलिताधरे रमते यमुनापुलिनवने विजयी मुरारिरधुना ॥`,
    e:`At dawn Radha sees on Krishna the marks of a night spent with another — kohl-smudged, garland-crushed. With wounded dignity she rebukes him: the conqueror Murari now roams the Yamuna groves, she says bitterly.` },

  { id:'16', s:`अनिलतरलकुवलयनयनेन सखि या रमिता वनमालिना ॥`,
    e:`O friend with eyes trembling like lotuses in the breeze — set aside your pride. She who is loved by the forest-garlanded one is truly blessed; do not waste this precious love on anger.` },

  { id:'17', s:`रजनिजनितगुरुजागररागकषायितमलसनिमेषम् याहि माधव याहि केशव मा वद कैतववादम् ॥`,
    e:`Your eyes heavy and reddened from a night of wakeful passion — Go, Madhava, go! Go, Keshava! Do not speak your deceitful sweet words to me now. Radha sends Krishna away in proud, wounded reproach.` },

  { id:'18', s:`हरिरभिसरति वहति मृदुपवने माधवे मा कुरु मानिनि मानमये ॥`,
    e:`Hari himself is coming to you through the soft night breeze — set aside your anger now, proud one. He who melts at your very quarrel has come to your door. The friend urges Radha: grace is at hand.` },

  { id:'19', s:`वदसि यदि किञ्चिदपि दन्तरुचिकौमुदी हरति दरतिमिरमतिघोरम् प्रिये चारुशीले मुञ्च मयि मानमनिदानम् ॥`,
    e:`If you would say even a single word, the moonlight of your teeth would scatter the terrible darkness of my dread. O beloved, O lovely-natured one — set aside this groundless anger; love's fire consumes me, grant me the nectar of your lotus face.` },

  { id:'20', s:`विरचितचाटुवचनरचनं चरणे रचितप्रणिपातम् मुग्धे मधुसूदनमनु ॥`,
    e:`He has woven sweet words of entreaty; he has bowed at your very feet. O innocent one — why do you still resist the slayer of Madhu? Go to him now.` },

  { id:'21', s:`प्रविश राधे माधवसमीपमिह मञ्जुतरकुञ्जतलकेलिसदने ॥`,
    e:`Enter now, Radha, into Madhava's presence — into the lovely bower-chamber set for love beneath the trees. The friend leads Radha to the waiting Krishna; the long-deferred union is at hand.` },

  { id:'22', s:`राधावदनविलोकनविकसितविविधविकारविभङ्गम् हरिमेकरसम् ॥`,
    e:`Gazing upon Radha's face, every play of feeling blossoming across it in the moonlight, Hari is overcome — the two at last united, each lost wholly in the other.` },

  { id:'23', s:`किसलय शयन तले कुरु कामिनि चरण नलिन विनिवेशम् ॥`,
    e:`Upon this couch of tender leaves, O loving one, set your lotus feet; let your wandering steps find their rest here with me. Krishna welcomes Radha into intimate and tender union.` },

  { id:'24', s:`कुरु यदुनन्दन चन्दन शिशिर तरेण करेण पयोधरे । मृगमद पत्रकम् अत्र मनोभव मङ्गल कलश सहोदरे ॥`,
    e:`O son of the Yadus — with your hand cool as sandal, draw musk designs upon my breast; arrange my loosened garments, my hair, my ornaments. After union, Radha asks Krishna to adorn her — and the Lord lovingly does so, completing the great drama of love.` }
];

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log(`\n🕉  Gita Govinda — Gemini TTS Generator`);
  console.log(`   Model : ${MODEL}`);
  console.log(`   Voices: ${VOICE_S} (Sanskrit)  ·  ${VOICE_E} (Meaning)`);
  console.log(`   Files : ${ITEMS.length * 2} total\n`);

  let done = 0, skipped = 0, errors = 0;

  for (const item of ITEMS) {
    const label = item.id === '00' ? 'Invocation' : `Song ${item.id}`;

    try {
      const r = await tts(stripIAST(item.s), VOICE_S, `gg_${item.id}_s.wav`, STYLE_S);
      r === 'skip' ? skipped++ : done++;
    } catch(e) { console.error(`❌  ${label} Sanskrit: ${e.message}`); errors++; }

    await sleep(2000); // longer gap — reduces silent rejections

    try {
      const r = await tts(item.e, VOICE_E, `gg_${item.id}_e.wav`, STYLE_E);
      r === 'skip' ? skipped++ : done++;
    } catch(e) { console.error(`❌  ${label} Meaning: ${e.message}`); errors++; }

    await sleep(800);
  }

  console.log(`\n──────────────────────────────`);
  console.log(`  ✓ Generated : ${done}`);
  console.log(`  ⏭ Skipped   : ${skipped}`);
  console.log(`  ❌ Errors    : ${errors}`);
  console.log(`\nNEXT STEPS:`);
  console.log(`  1.  git init`);
  console.log(`  2.  git add audio/`);
  console.log(`  3.  git commit -m "Gita Govinda audio — Gemini 2.5 Flash TTS"`);
  console.log(`  4.  Push to PUBLIC GitHub repo:  gita-govinda-audio`);
  console.log(`  5.  jsDelivr CDN URL:`);
  console.log(`      https://cdn.jsdelivr.net/gh/YOUR_USERNAME/gita-govinda-audio@main/audio/gg_01_s.wav\n`);
}

main().catch(console.error);
